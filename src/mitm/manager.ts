import { exec, spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import net from "net";
import https from "https";
import crypto from "crypto";
import { addDNSEntry, removeDNSEntry, removeAllDNSEntries, removeAllDNSEntriesSync, checkAllDNSStatus, TOOL_HOSTS, isSudoAvailable, isSudoPasswordRequired } from "./dns/dnsConfig";
import { isAdmin } from "./winElevated";

const IS_WIN: boolean = process.platform === "win32";
const IS_MAC: boolean = process.platform === "darwin";
import { generateCert } from "./cert/generate";
import { installCert, uninstallCert } from "./cert/install";
import { isCertExpired } from "./cert/rootCA";
import { DATA_DIR, MITM_DIR } from "./paths";
import { log, err } from "./logger";
import { LSOF_BIN } from "./config";

const DEFAULT_MITM_ROUTER_BASE: string = "http://localhost:20128";

function shellQuoteSingle(str: string | null | undefined): string {
  if (str == null || str === "") return "''";
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

async function resolveMitmRouterBaseUrl(): Promise<string> {
  if (!_getSettings) return DEFAULT_MITM_ROUTER_BASE;
  try {
    const s: any = await _getSettings();
    const raw: string = s && s.mitmRouterBaseUrl != null ? String(s.mitmRouterBaseUrl).trim() : "";
    if (!raw) return DEFAULT_MITM_ROUTER_BASE;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_MITM_ROUTER_BASE;
    return raw.replace(/\/+$/, "");
  } catch {
    return DEFAULT_MITM_ROUTER_BASE;
  }
}

const MITM_PORT: number = 443;
const MITM_WIN_NODE_PORT: number = 8443;
const PID_FILE: string = path.join(MITM_DIR, ".mitm.pid");
const LOCK_FILE: string = path.join(MITM_DIR, ".mitm.lock");

const MITM_MAX_RESTARTS: number = 5;
const MITM_RESTART_DELAYS_MS: number[] = [5000, 10000, 20000, 30000, 60000];
const MITM_RESTART_RESET_MS: number = 60000;

let mitmRestartCount: number = 0;
let mitmLastStartTime: number = 0;
let mitmIsRestarting: boolean = false;

function resolveBundledServerPath(): string {
  if (process.env.MITM_SERVER_PATH) return process.env.MITM_SERVER_PATH;
  const sibling: string = path.join(__dirname, "server.js");
  if (fs.existsSync(sibling)) return sibling;
  const fromCwd: string = path.join(process.cwd(), "src", "mitm", "server.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromNext: string = path.join(process.cwd(), "..", "src", "mitm", "server.js");
  if (fs.existsSync(fromNext)) return fromNext;
  return fromCwd;
}

function ensureRuntimeServer(bundledPath: string): string {
  try {
    if (!bundledPath || !fs.existsSync(bundledPath)) return bundledPath;

    if (!bundledPath.includes(`${path.sep}node_modules${path.sep}`)) {
      return bundledPath;
    }

    const runtimeDir: string = path.join(DATA_DIR, "runtime", "mitm");
    const runtimeServer: string = path.join(runtimeDir, "server.js");

    if (fs.existsSync(runtimeServer)) {
      try {
        if (fs.statSync(bundledPath).size === fs.statSync(runtimeServer).size) return runtimeServer;
      } catch { /* recopy */ }
    }

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(bundledPath, runtimeServer);
    return runtimeServer;
  } catch (e: any) {
    try { log(`[MITM] runtime copy failed: ${e.message}`); } catch { /* ignore */ }
    return bundledPath;
  }
}

const SERVER_PATH: string = ensureRuntimeServer(resolveBundledServerPath());
const ENCRYPT_ALGO: string = "aes-256-gcm";
const ENCRYPT_SALT: string = "9router-mitm-pwd";

function getProcessUsingPort443(): string | null {
  try {
    if (IS_WIN) {
      const psCmd: string = `powershell -NonInteractive -WindowStyle Hidden -Command ` +
        `"$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }"`;
      const pidStr: string = execSync(psCmd, { encoding: "utf8", windowsHide: true }).trim();
      const pid: number = parseInt(pidStr, 10);
      if (pid && pid > 4) {
        const tasklistResult: string = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", windowsHide: true });
        const processMatch: RegExpMatchArray | null = tasklistResult.match(/"([^"]+)"/);
        if (processMatch) return processMatch[1].replace(".exe", "");
      }
    } else {
      const result: string = execSync(`${LSOF_BIN} -i :443`, { encoding: "utf8", windowsHide: true });
      const lines: string[] = result.trim().split("\n");
      if (lines.length > 1) return lines[1].split(/\s+/)[0];
    }
  } catch {
    return null;
  }
  return null;
}

let serverProcess: ReturnType<typeof spawn> | null = null;
let serverPid: number | null = null;

function getCachedPassword(): string | null { return (globalThis as any).__mitmSudoPassword || null; }
function setCachedPassword(pwd: string | null): void { (globalThis as any).__mitmSudoPassword = pwd; }

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === "EACCES";
  }
}

function killProcess(pid: number, force: boolean = false, sudoPassword: string | null = null): void {
  if (IS_WIN) {
    const flag: string = force ? "/F " : "";
    exec(`taskkill ${flag}/PID ${pid}`, { windowsHide: true }, () => { });
  } else {
    const sig: string = force ? "SIGKILL" : "SIGTERM";
    const cmd: string = `pkill -${sig} -P ${pid} 2>/dev/null; kill -${sig} ${pid} 2>/dev/null`;
    if (sudoPassword || isSudoAvailable()) {
      const { execWithPassword } = require("./dns/dnsConfig");
      execWithPassword(cmd, sudoPassword || "").catch(() => exec(cmd, { windowsHide: true }, () => { }));
    } else {
      exec(cmd, { windowsHide: true }, () => { });
    }
  }
}

function deriveKey(): Buffer {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw: string = machineIdSync();
    return crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

function encryptPassword(plaintext: string): string {
  const key: Buffer = deriveKey();
  const iv: Buffer = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted: Buffer = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag: Buffer = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptPassword(stored: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key: Buffer = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
  } catch {
    return null;
  }
}

type SettingsGetter = (() => Promise<any>) | null;
type SettingsUpdater = ((updates: Record<string, any>) => Promise<any>) | null;

let _getSettings: SettingsGetter = null;
let _updateSettings: SettingsUpdater = null;

function initDbHooks(getSettingsFn: SettingsGetter, updateSettingsFn: SettingsUpdater): void {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

async function saveMitmSettings(enabled: boolean, password: string | null): Promise<void> {
  if (!_updateSettings) return;
  try {
    const updates: Record<string, any> = { mitmEnabled: enabled };
    if (password) updates.mitmSudoEncrypted = encryptPassword(password);
    await _updateSettings(updates);
  } catch (e: any) {
    err(`Failed to save settings: ${e.message}`);
  }
}

async function clearEncryptedPassword(): Promise<void> {
  if (!_updateSettings) return;
  try {
    await _updateSettings({ mitmSudoEncrypted: null });
  } catch (e: any) {
    err(`Failed to clear encrypted password: ${e.message}`);
  }
}

async function loadEncryptedPassword(): Promise<string | null> {
  if (!_getSettings) return null;
  try {
    const settings: any = await _getSettings();
    if (!settings.mitmSudoEncrypted) return null;
    return decryptPassword(settings.mitmSudoEncrypted);
  } catch {
    return null;
  }
}

async function saveDnsToolState(tool: string, enabled: boolean): Promise<void> {
  if (!_updateSettings || !_getSettings) return;
  try {
    const s: any = await _getSettings();
    const next: Record<string, boolean> = { ...(s.dnsToolEnabled || {}), [tool]: enabled };
    await _updateSettings({ dnsToolEnabled: next });
  } catch (e: any) {
    err(`Failed to save DNS state: ${e.message}`);
  }
}

async function loadDnsToolState(): Promise<Record<string, boolean>> {
  if (!_getSettings) return {};
  try {
    const s: any = await _getSettings();
    return s.dnsToolEnabled || {};
  } catch {
    return {};
  }
}

/**
 * Re-apply DNS for tools previously enabled — called on app startup after MITM running.
 */
async function restoreToolDNS(sudoPassword: string | null): Promise<void> {
  const state: Record<string, boolean> = await loadDnsToolState();
  const password: string | null = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  for (const [tool, enabled] of Object.entries(state)) {
    if (!enabled || !TOOL_HOSTS[tool]) continue;
    try {
      await addDNSEntry(tool, password);
    } catch (e: any) {
      err(`DNS ${tool}: restore failed — ${e.message}`);
    }
  }
}

/**
 * Check if user has privilege to mutate hosts file.
 */
async function hasDnsPrivilege(): Promise<boolean> {
  if (IS_WIN) return isAdmin();
  if (isAdmin()) return true;
  if (!isSudoPasswordRequired()) return true;
  const pwd: string | null = getCachedPassword() || await loadEncryptedPassword();
  return !!pwd;
}

function checkPort443Free(): Promise<string> {
  return new Promise<string>((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve("in-use");
      else resolve("no-permission");
    });
    tester.once("listening", () => { tester.close(() => resolve("free")); });
    tester.listen(MITM_PORT, "127.0.0.1");
  });
}

interface PortOwner { pid: number; name: string; }

function getPort443Owner(sudoPassword: string | null): Promise<PortOwner | null> {
  return new Promise<PortOwner | null>((resolve) => {
    if (IS_WIN) {
      const psCmd: string = `powershell -NonInteractive -WindowStyle Hidden -Command "` +
        `$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if ($c) { $c.OwningProcess } else { 0 }"`;    
      exec(psCmd, { windowsHide: true }, (err: Error | null, stdout: string) => {
        if (err) return resolve(null);
        const pid: number = parseInt(stdout.trim(), 10);
        if (!pid || pid <= 4) return resolve(null);
        exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true }, (e2: Error | null, out2: string) => {
          const m: RegExpMatchArray | null = out2?.match(/"([^"]+)"/);
          resolve({ pid, name: m ? m[1] : "unknown" });
        });
      });
    } else {
      exec(`${LSOF_BIN} -nP -iTCP:443 -sTCP:LISTEN -t`, { windowsHide: true }, (err: Error | null, stdout: string) => {
        if (err || !stdout?.trim()) return resolve(null);
        const pid: number = parseInt(stdout.trim().split("\n")[0], 10);
        if (!pid || isNaN(pid)) return resolve(null);
        exec(`ps -p ${pid} -o comm=`, { windowsHide: true }, (e2: Error | null, out2: string) => {
          resolve({ pid, name: (out2?.trim() || "unknown") });
        });
      });
    }
  });
}

async function killLeftoverMitm(sudoPassword: string | null): Promise<void> {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill("SIGKILL"); } catch { /* ignore */ }
    serverProcess = null;
    serverPid = null;
  }
  try {
    if (fs.existsSync(PID_FILE)) {
      const savedPid: number = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (savedPid && isProcessAlive(savedPid)) {
        killProcess(savedPid, true, sudoPassword);
        await new Promise<void>(r => setTimeout(r, 500));
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch { /* ignore */ }
  if (!IS_WIN && SERVER_PATH) {
    try {
      const escaped: string = SERVER_PATH.replace(/'/g, "'\\''");
      if (sudoPassword || isSudoAvailable()) {
        const { execWithPassword } = require("./dns/dnsConfig");
        await execWithPassword(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, sudoPassword || "").catch(() => { });
      } else {
        exec(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, { windowsHide: true }, () => { });
      }
      await new Promise<void>(r => setTimeout(r, 500));
    } catch { /* ignore */ }
  }
}

interface HealthResult { ok: boolean; pid: number | null; }

function pollMitmHealth(timeoutMs: number, port: number = MITM_PORT): Promise<HealthResult | null> {
  return new Promise<HealthResult | null>((resolve) => {
    const deadline: number = Date.now() + timeoutMs;
    const check = (): void => {
      const req = https.request(
        { hostname: "127.0.0.1", port, path: "/_mitm_health", method: "GET", rejectUnauthorized: false },
        (res) => {
          let body: string = "";
          res.on("data", (d: Buffer) => { body += d; });
          res.on("end", () => {
            try {
              const json: any = JSON.parse(body);
              resolve(json.ok === true ? { ok: true, pid: json.pid || null } : null);
            } catch { resolve(null); }
          });
        }
      );
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(check, 500);
        else resolve(null);
      });
      req.end();
    };
    check();
  });
}

interface MitmStatus {
  running: boolean;
  pid: number | null;
  certExists: boolean;
  certTrusted: boolean;
  dnsStatus: Record<string, boolean>;
}

/**
 * Get full MITM status including per-tool DNS status
 */
async function getMitmStatus(): Promise<MitmStatus> {
  let running: boolean = serverProcess !== null && !serverProcess.killed;
  let pid: number | null = serverPid;

  if (!running) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid: number = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          running = true;
          pid = savedPid;
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { /* ignore */ }
  }

  const dnsStatus: Record<string, boolean> = checkAllDNSStatus();
  const rootCACertPath: string = path.join(MITM_DIR, "rootCA.crt");
  const certExists: boolean = fs.existsSync(rootCACertPath);
  const { checkCertInstalled } = require("./cert/install");
  const certTrusted: boolean = certExists ? await checkCertInstalled(rootCACertPath) : false;

  return { running, pid, certExists, certTrusted, dnsStatus };
}

async function scheduleMitmRestart(apiKey: string): Promise<void> {
  if (mitmIsRestarting) return;
  mitmIsRestarting = true;

  const aliveMs: number = Date.now() - mitmLastStartTime;
  if (aliveMs >= MITM_RESTART_RESET_MS) mitmRestartCount = 0;

  if (mitmRestartCount >= MITM_MAX_RESTARTS) {
    err("Max restart attempts reached. Giving up.");
    mitmIsRestarting = false;
    return;
  }

  const attempt: number = mitmRestartCount;
  const delay: number = MITM_RESTART_DELAYS_MS[Math.min(attempt, MITM_RESTART_DELAYS_MS.length - 1)];
  mitmRestartCount++;

  log(`Restarting in ${delay / 1000}s... (${mitmRestartCount}/${MITM_MAX_RESTARTS})`);
  await new Promise<void>((r) => setTimeout(r, delay));

  try {
    const settings: any = _getSettings ? await _getSettings() : null;
    if (settings && !settings.mitmEnabled) {
      log("MITM disabled, skipping restart");
      mitmIsRestarting = false;
      return;
    }
    const password: string | null = getCachedPassword() || await loadEncryptedPassword();
    if (!password && !IS_WIN) {
      err("No cached password, cannot auto-restart");
      mitmIsRestarting = false;
      return;
    }
    await startServer(apiKey, password);
    log("🔄 Restarted successfully");
    mitmRestartCount = 0;
    mitmIsRestarting = false;
  } catch (e: any) {
    err(`Restart attempt ${mitmRestartCount}/${MITM_MAX_RESTARTS} failed: ${e.message}`);
    mitmIsRestarting = false;
    scheduleMitmRestart(apiKey);
  }
}

interface StartResult { running: boolean; pid: number | null; }

/**
 * Start MITM server only (cert + server, no DNS)
 */
async function killPort443Owner(owner: PortOwner, sudoPassword: string | null): Promise<void> {
  if (!owner || !owner.pid) return;
  if (IS_WIN) {
    try {
      execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "Stop-Process -Id ${owner.pid} -Force -ErrorAction SilentlyContinue"`, { windowsHide: true });
    } catch { /* best effort */ }
  } else {
    try {
      const { execWithPassword } = require("./dns/dnsConfig");
      if (sudoPassword || isSudoAvailable()) {
        await execWithPassword(`kill -9 ${owner.pid}`, sudoPassword || "");
      } else {
        execSync(`kill -9 ${owner.pid}`, { windowsHide: true });
      }
    } catch { /* best effort */ }
  }
  await new Promise<void>(r => setTimeout(r, 800));
}

async function startServer(apiKey: string, sudoPassword: string | null, forceKillPort443: boolean = false): Promise<StartResult> {
  if (!serverProcess || serverProcess.killed) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid: number = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          serverPid = savedPid;
          log(`♻️ Reusing existing process (PID: ${savedPid})`);
          await saveMitmSettings(true, sudoPassword);
          if (sudoPassword) setCachedPassword(sudoPassword);
          return { running: true, pid: savedPid };
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { /* ignore */ }
  }

  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM server is already running");
  }

  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
  } catch (e: any) {
    if (e.code === "EEXIST") {
      let stale: boolean = false;
      try {
        const pid: number = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
        stale = !pid || !isProcessAlive(pid);
      } catch { stale = true; }
      if (!stale) throw new Error("MITM server is already starting (lock contention)");
      try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
    } else throw e;
  }

  try {
    await killLeftoverMitm(sudoPassword);

  if (!IS_WIN) {
    const portStatus: string = await checkPort443Free();
    if (portStatus === "in-use" || portStatus === "no-permission") {
      const owner: PortOwner | null = await getPort443Owner(sudoPassword);
      if (owner) {
        const shortName: string = owner.name.includes("/")
          ? owner.name.split("/").filter(Boolean).pop()!
          : owner.name;
        if (forceKillPort443) {
          log(`Killing process on port 443 (PID ${owner.pid}, name=${shortName})...`);
          await killPort443Owner(owner, sudoPassword);
        } else {
          const e: any = new Error(`Port 443 is already in use by "${shortName}" (PID ${owner.pid}).`);
          e.code = "PORT_443_BUSY";
          e.portOwner = { pid: owner.pid, name: shortName };
          throw e;
        }
      }
    }
  }

  // Step 1: Generate Root CA if missing or expired
  const rootCACertPath: string = path.join(MITM_DIR, "rootCA.crt");
  const rootCAKeyPath: string = path.join(MITM_DIR, "rootCA.key");
  const certExists: boolean = fs.existsSync(rootCACertPath) && fs.existsSync(rootCAKeyPath);

  if (!certExists || isCertExpired(rootCACertPath)) {
    if (certExists) {
      log("🔐 Cert expired — uninstalling old cert...");
      const password: string | null = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
      try { await uninstallCert(password, rootCACertPath); } catch { /* best effort */ }
    }
    log("🔐 Generating Root CA...");
    await generateCert();
  }

  // Step 1.5: Auto-install Root CA if not trusted yet
  const { checkCertInstalled } = require("./cert/install");
  const rootCATrusted: boolean = await checkCertInstalled(rootCACertPath);
  const linuxNoSystemTrust: boolean = !IS_WIN && !IS_MAC && !isSudoAvailable();
  if (!rootCATrusted) {
    log("🔐 Cert: not trusted → installing...");
    const password: string | null = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
    if (linuxNoSystemTrust) {
      log(`🔐 Cert: skipping system trust (no sudo). Install ${rootCACertPath} as a trusted CA on machines that use this proxy.`);
    } else {
      if (!password && isSudoPasswordRequired()) {
        throw new Error("Sudo password required to install Root CA certificate");
      }
      try {
        await installCert(password, rootCACertPath);
        log("🔐 Cert: ✅ trusted");
      } catch (e: any) {
        throw new Error(`Failed to trust certificate: ${e.message}`);
      }
    }
  } else {
    log("🔐 Cert: already trusted ✅");
  }

  // Step 2: Spawn server
  let effectiveServerPath: string = SERVER_PATH;
  if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
    log(`[MITM] server.js missing at ${effectiveServerPath} → recopying`);
    effectiveServerPath = ensureRuntimeServer(resolveBundledServerPath());
    if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
      throw new Error(`MITM server.js not found at ${effectiveServerPath}. Reinstall 9router.`);
    }
  }
  const mitmRouterBase: string = await resolveMitmRouterBaseUrl();
  log(`🚀 Starting server... (router: ${mitmRouterBase})`);
  if (IS_WIN) {
    const winOwner: PortOwner | null = await getPort443Owner(sudoPassword);
    if (winOwner) {
      if (forceKillPort443) {
        log(`Killing process on port 443 (PID ${winOwner.pid}, name=${winOwner.name})...`);
        await killPort443Owner(winOwner, sudoPassword);
      } else {
        const e: any = new Error(`Port 443 is already in use by "${winOwner.name}" (PID ${winOwner.pid}).`);
        e.code = "PORT_443_BUSY";
        e.portOwner = { pid: winOwner.pid, name: winOwner.name };
        throw e;
      }
    }

    serverProcess = spawn(
      process.execPath,
      [effectiveServerPath],
      {
        detached: false,
        windowsHide: true,
        cwd: os.tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ROUTER_API_KEY: apiKey,
          NODE_ENV: "production",
          MITM_ROUTER_BASE: mitmRouterBase,
        },
      }
    );

    if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });
  } else if (isSudoAvailable()) {
    const inlineCmd: string = [
      `HOME=${shellQuoteSingle(os.homedir())}`,
      `ROUTER_API_KEY=${shellQuoteSingle(apiKey)}`,
      `MITM_ROUTER_BASE=${shellQuoteSingle(mitmRouterBase)}`,
      "NODE_ENV=production",
      shellQuoteSingle(process.execPath),
      shellQuoteSingle(effectiveServerPath),
    ].join(" ");
    serverProcess = spawn(
      "sudo", ["-S", "-E", "sh", "-c", inlineCmd],
      { detached: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    serverProcess.stdin!.write(`${sudoPassword}\n`);
    serverProcess.stdin!.end();
  } else {
    serverProcess = spawn(process.execPath, [effectiveServerPath], {
      detached: false,
      windowsHide: true,
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ROUTER_API_KEY: apiKey,
        NODE_ENV: "production",
        MITM_ROUTER_BASE: mitmRouterBase,
      },
    });
  }

  if (serverProcess) {
    serverPid = serverProcess.pid!;
    fs.writeFileSync(PID_FILE, String(serverPid));
    mitmLastStartTime = Date.now();
  }

  // Set NODE_EXTRA_CA_CERTS so Node-based GUI apps trust MITM cert
  if (IS_MAC) {
    const rootCAPath: string = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      exec(`launchctl setenv NODE_EXTRA_CA_CERTS "${rootCAPath}"`, { windowsHide: true }, (e: Error | null) => {
        if (e) log(`[launchctl] Failed to set NODE_EXTRA_CA_CERTS: ${e.message}`);
        else log(`[launchctl] NODE_EXTRA_CA_CERTS set to ${rootCAPath}`);
      });
    }
  } else if (IS_WIN) {
    const rootCAPath: string = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      exec(`setx NODE_EXTRA_CA_CERTS "${rootCAPath}"`, { windowsHide: true }, (e: Error | null) => {
        if (e) log(`[setx] Failed to set NODE_EXTRA_CA_CERTS: ${e.message}`);
        else log(`[setx] NODE_EXTRA_CA_CERTS set for current user`);
      });
    }
  }

  let startError: string | null = null;
  if (serverProcess) {
    serverProcess.stdout!.on("data", (data: Buffer) => {
      process.stdout.write(data);
    });
    serverProcess.stderr!.on("data", (data: Buffer) => {
      const msg: string = data.toString().trim();
      if (msg && (IS_WIN || (!msg.includes("Password:") && !msg.includes("password for")))) {
        err(msg);
        startError = msg;
      }
      if (!IS_WIN && (msg.includes("incorrect password") || msg.includes("no password was provided"))) {
        setCachedPassword(null);
        clearEncryptedPassword();
        mitmIsRestarting = true;
      }
    });
    serverProcess.on("exit", (code: number | null) => {
      log(`Server exited (code: ${code})`);
      serverProcess = null;
      serverPid = null;
      try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
      try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
      if (code !== 0 && !mitmIsRestarting) scheduleMitmRestart(apiKey);
    });
  }

  const health: HealthResult | null = await pollMitmHealth(8000, MITM_PORT);
  if (!health) {
    if (serverProcess && !serverProcess.killed) { try { serverProcess.kill(); } catch { /* ignore */ } serverProcess = null; }
    const processUsing443: string | null = getProcessUsingPort443();
    const portInfo: string = processUsing443 ? ` Port 443 already in use by ${processUsing443}.` : "";
    const reason: string = startError || `Check sudo password or port 443 access.${portInfo}`;
    throw new Error(`MITM server failed to start. ${reason}`);
  }

  if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });

  log(`✅ Server healthy (PID: ${serverPid || health.pid})`);

  const dnsStatus: Record<string, boolean> = checkAllDNSStatus();
  for (const [tool, active] of Object.entries(dnsStatus)) {
    log(`🌐 DNS ${tool}: ${active ? "✅ active" : "❌ inactive"}`);
  }

  await saveMitmSettings(true, sudoPassword);
  if (sudoPassword) setCachedPassword(sudoPassword);

  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }

  return { running: true, pid: serverPid };
  } catch (e) {
    try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Stop MITM server — removes ALL tool DNS entries first, then kills server
 */
async function stopServer(sudoPassword: string | null): Promise<StartResult> {
  mitmIsRestarting = true;
  mitmRestartCount = 0;
  log("⏹ Stopping server...");

  const proc = serverProcess;
  const pidToKill: number | null = proc && !proc.killed
    ? proc.pid!
    : (() => { try { return parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10); } catch { return null; } })();

  if (pidToKill && isProcessAlive(pidToKill)) {
    log(`Killing server (PID: ${pidToKill})...`);
    killProcess(pidToKill, false, sudoPassword);
    await new Promise<void>(r => setTimeout(r, 1000));
    if (isProcessAlive(pidToKill)) killProcess(pidToKill, true, sudoPassword);
  }
  serverProcess = null;
  serverPid = null;

  if (IS_WIN) {
    const hostsFile: string = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
    const allHosts: string[] = Object.values(TOOL_HOSTS).flat();
    try {
      const { isAdmin, runElevatedPowerShell, quotePs } = require("./winElevated");
      if (isAdmin()) {
        const content: string = fs.readFileSync(hostsFile, "utf8");
        const filtered: string = content.split(/\r?\n/).filter((l: string) => !allHosts.some((h: string) => l.includes(h))).join("\r\n");
        const next: string = filtered.replace(/[\r\n\s]+$/g, "") + "\r\n";
        if (next !== content) fs.writeFileSync(hostsFile, next, "utf8");
        try { require("child_process").execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { /* ignore */ }
        log("🌐 DNS: ✅ all tool hosts removed");
      } else {
        const hostsList: string = allHosts.map(quotePs).join(",");
        const script: string = `
          $hosts = @(${hostsList})
          $lines = Get-Content -LiteralPath ${quotePs(hostsFile)}
          $filtered = $lines | Where-Object {
            $line = $_
            -not ($hosts | Where-Object { $line -match [regex]::Escape($_) })
          }
          Set-Content -LiteralPath ${quotePs(hostsFile)} -Value $filtered
          ipconfig /flushdns | Out-Null
        `;
        await runElevatedPowerShell(script);
      }
    } catch (e: any) { err(`Failed to clean hosts: ${e.message}`); }
  } else {
    await removeAllDNSEntries(sudoPassword);
  }

  if (IS_MAC) {
    exec(`launchctl unsetenv NODE_EXTRA_CA_CERTS`, { windowsHide: true }, (e: Error | null) => {
      if (e) log(`[launchctl] Failed to unset NODE_EXTRA_CA_CERTS: ${e.message}`);
      else log(`[launchctl] NODE_EXTRA_CA_CERTS unset`);
    });
  } else if (IS_WIN) {
    exec(`reg delete HKCU\\Environment /F /V NODE_EXTRA_CA_CERTS`, { windowsHide: true }, (e: Error | null) => {
      if (e) log(`[reg] Failed to unset NODE_EXTRA_CA_CERTS: ${e.message}`);
      else log(`[reg] NODE_EXTRA_CA_CERTS unset`);
    });
  }

  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  await saveMitmSettings(false, null);
  mitmIsRestarting = false;

  return { running: false, pid: null };
}

/**
 * Enable DNS for a specific tool (requires server running)
 */
async function enableToolDNS(tool: string, sudoPassword: string | null): Promise<{ success: boolean }> {
  const status: MitmStatus = await getMitmStatus();
  if (!status.running) throw new Error("MITM server is not running. Start the server first.");

  const password: string | null = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await addDNSEntry(tool, password);
  await saveDnsToolState(tool, true);
  return { success: true };
}

/**
 * Disable DNS for a specific tool
 */
async function disableToolDNS(tool: string, sudoPassword: string | null): Promise<{ success: boolean }> {
  const password: string | null = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await removeDNSEntry(tool, password);
  await saveDnsToolState(tool, false);
  return { success: true };
}

/**
 * Install Root CA to system trust store (standalone, no server start)
 */
async function trustCert(sudoPassword: string | null): Promise<void> {
  const rootCACertPath: string = path.join(MITM_DIR, "rootCA.crt");
  if (!fs.existsSync(rootCACertPath)) throw new Error("Root CA not found. Start server first to generate it.");
  const { installCert } = require("./cert/install");
  if (!IS_WIN && !IS_MAC && !isSudoAvailable()) {
    log(`🔐 Cert: system trust unavailable (no sudo). Use file: ${rootCACertPath}`);
    return;
  }
  const password: string | null = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  if (!password && isSudoPasswordRequired()) throw new Error("Sudo password required to trust certificate");
  await installCert(password, rootCACertPath);
  if (password) setCachedPassword(password);
}

// Legacy aliases for backward compatibility
const startMitm = startServer;
const stopMitm = stopServer;

export {
  getMitmStatus,
  startServer,
  stopServer,
  enableToolDNS,
  disableToolDNS,
  trustCert,
  startMitm,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  isSudoPasswordRequired,
  initDbHooks,
  restoreToolDNS,
  removeAllDNSEntriesSync,
};
