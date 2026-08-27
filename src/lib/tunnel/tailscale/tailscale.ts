import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execSync, exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { execWithPassword } from "@/lib/elevatedExec";
import { DATA_DIR } from "@/lib/dataDir";

const execAsync: (command: string, options?: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

const BIN_DIR: string = path.join(DATA_DIR, "bin");
const IS_MAC: boolean = os.platform() === "darwin";
const IS_LINUX: boolean = os.platform() === "linux";
const IS_WINDOWS: boolean = os.platform() === "win32";
const TAILSCALE_BIN: string = path.join(BIN_DIR, IS_WINDOWS ? "tailscale.exe" : "tailscale");

// Custom socket for userspace-networking mode (no root required)
const TAILSCALE_DIR: string = path.join(DATA_DIR, "tailscale");
export const TAILSCALE_SOCKET: string = path.join(TAILSCALE_DIR, "tailscaled.sock");
const SOCKET_FLAG: string[] = IS_WINDOWS ? [] : ["--socket", TAILSCALE_SOCKET];

// System daemon socket (sudo install: apt/snap/systemd) — read-only status detection
const SYSTEM_TAILSCALE_SOCKET: string | null = IS_WINDOWS ? null : "/var/run/tailscale/tailscaled.sock";
const SYSTEM_SOCKET_FLAG: string[] = SYSTEM_TAILSCALE_SOCKET ? ["--socket", SYSTEM_TAILSCALE_SOCKET] : [];

// Well-known Windows install path
const WINDOWS_TAILSCALE_BIN: string = "C:\\Program Files\\Tailscale\\tailscale.exe";

// Common Unix install paths to probe synchronously (system tailscale)
const UNIX_TAILSCALE_CANDIDATES: string[] = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/sbin/tailscale",
  "/usr/bin/tailscale",
  "/snap/bin/tailscale",
];

// ─── Cache + background refresh (avoid blocking event loop on dead daemon) ──
const PROBE_TTL_MS: number = 10000;
const PROBE_TIMEOUT_MS: number = 1500;

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  refreshing: boolean;
}

const binCache: CacheEntry<string | null> = { value: undefined as unknown as string | null, fetchedAt: 0, refreshing: false };
const runningCache: CacheEntry<boolean> = { value: false, fetchedAt: 0, refreshing: false };
const loggedInCache: CacheEntry<boolean> = { value: false, fetchedAt: 0, refreshing: false };
const funnelUrlCache: CacheEntry<string | null> & { port: number | null } = { value: null, port: null, fetchedAt: 0, refreshing: false };

function fallbackBin(): string | null {
  if (fs.existsSync(TAILSCALE_BIN)) return TAILSCALE_BIN;
  if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) return WINDOWS_TAILSCALE_BIN;
  if (!IS_WINDOWS) return UNIX_TAILSCALE_CANDIDATES.find((p: string) => fs.existsSync(p)) || null;
  return null;
}

const EXTENDED_PATH: string = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;

function bgRefreshBin(): void {
  if (binCache.refreshing) return;
  binCache.refreshing = true;
  const cmd: string = IS_WINDOWS ? "where tailscale 2>nul" : "which tailscale 2>/dev/null";
  execAsync(cmd, { windowsHide: true, timeout: PROBE_TIMEOUT_MS, env: { ...process.env, PATH: EXTENDED_PATH } })
    .then(({ stdout }: { stdout: string }) => {
      const sys: string = stdout.trim();
      binCache.value = sys || fallbackBin();
    })
    .catch(() => { binCache.value = fallbackBin(); })
    .finally(() => {
      binCache.fetchedAt = Date.now();
      binCache.refreshing = false;
    });
}

// Sync getter: returns cached value, triggers background refresh if stale
export function getTailscaleBin(): string | null {
  if (Date.now() - binCache.fetchedAt > PROBE_TTL_MS) bgRefreshBin();
  // First call: synchronously probe common install paths (no exec, no event-loop block)
  if (binCache.value === undefined) {
    if (fs.existsSync(TAILSCALE_BIN)) binCache.value = TAILSCALE_BIN;
    else if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) binCache.value = WINDOWS_TAILSCALE_BIN;
    else if (!IS_WINDOWS) {
      const found: string | undefined = UNIX_TAILSCALE_CANDIDATES.find((p: string) => fs.existsSync(p));
      binCache.value = found || null;
    } else binCache.value = null;
  }
  return binCache.value;
}

export function isTailscaleInstalled(): boolean {
  return getTailscaleBin() !== null;
}

/** Build tailscale CLI args with custom socket (no root needed) */
function tsArgs(...args: string[]): string[] {
  return [...SOCKET_FLAG, ...args];
}

// Async strict probe: authoritative, awaitable (never blocks event loop). Updates cache.
export async function isTailscaleLoggedInStrict(): Promise<boolean> {
  const bin: string | null = getTailscaleBin();
  if (!bin) return false;
  try {
    const { stdout }: { stdout: string } = await execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 5000
    });
    const json: Record<string, unknown> = JSON.parse(stdout);
    const loggedIn: boolean = json.BackendState === "Running" && (json.Self as Record<string, unknown>)?.Online === true;
    loggedInCache.value = loggedIn;
    loggedInCache.fetchedAt = Date.now();
    return loggedIn;
  } catch {
    return false;
  }
}

function bgRefreshLoggedIn(): void {
  if (loggedInCache.refreshing) return;
  const bin: string | null = getTailscaleBin();
  if (!bin) {
    loggedInCache.value = false;
    loggedInCache.fetchedAt = Date.now();
    return;
  }
  loggedInCache.refreshing = true;
  probeStatusAsync(bin)
    .then((json: Record<string, unknown> | null) => {
      loggedInCache.value = !!json && json.BackendState === "Running" && (json.Self as Record<string, unknown>)?.Online === true;
    })
    .catch(() => { loggedInCache.value = false; })
    .finally(() => {
      loggedInCache.fetchedAt = Date.now();
      loggedInCache.refreshing = false;
    });
}

// Probe `status --json` over custom then system socket. Resolves parsed JSON or null. Never blocks event loop.
async function probeStatusAsync(bin: string): Promise<Record<string, unknown> | null> {
  for (const socketArgs of [SOCKET_FLAG, SYSTEM_SOCKET_FLAG]) {
    try {
      const { stdout }: { stdout: string } = await execAsync(`"${bin}" ${socketArgs.join(" ")} status --json`, {
        windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: PROBE_TIMEOUT_MS,
      });
      return JSON.parse(stdout);
    } catch { /* try next socket */ }
  }
  return null;
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleLoggedIn(): boolean {
  if (Date.now() - loggedInCache.fetchedAt > PROBE_TTL_MS) bgRefreshLoggedIn();
  return loggedInCache.value;
}

function bgRefreshRunning(): void {
  if (runningCache.refreshing) return;
  const bin: string | null = getTailscaleBin();
  if (!bin) {
    runningCache.value = false;
    runningCache.fetchedAt = Date.now();
    return;
  }
  runningCache.refreshing = true;
  execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json`, { windowsHide: true, timeout: PROBE_TIMEOUT_MS })
    .then(({ stdout }: { stdout: string }) => {
      try {
        const json: Record<string, unknown> = JSON.parse(stdout);
        runningCache.value = Object.keys((json.AllowFunnel as Record<string, unknown>) || {}).length > 0;
      } catch { runningCache.value = false; }
    })
    .catch(() => { runningCache.value = false; })
    .finally(() => {
      runningCache.fetchedAt = Date.now();
      runningCache.refreshing = false;
    });
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleRunning(): boolean {
  if (Date.now() - runningCache.fetchedAt > PROBE_TTL_MS) bgRefreshRunning();
  return runningCache.value;
}

// Async strict probe for hot user-initiated paths (enable/connect flow).
export async function isTailscaleRunningStrict(): Promise<boolean> {
  const bin: string | null = getTailscaleBin();
  if (!bin) return false;
  try {
    const { stdout }: { stdout: string } = await execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json`, {
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
    });
    const json: Record<string, unknown> = JSON.parse(stdout);
    const running: boolean = Object.keys((json.AllowFunnel as Record<string, unknown>) || {}).length > 0;
    runningCache.value = running;
    runningCache.fetchedAt = Date.now();
    return running;
  } catch {
    return false;
  }
}

// Check if a system-level tailscaled is running (uses system socket, not 9Router's custom one).
export function isSystemDaemonRunning(): boolean {
  if (IS_WINDOWS || !SYSTEM_TAILSCALE_SOCKET || !fs.existsSync(SYSTEM_TAILSCALE_SOCKET)) return false;
  const bin: string | null = getTailscaleBin();
  if (!bin) return false;
  try {
    const out: string = execSync(`"${bin}" ${SYSTEM_SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: PROBE_TIMEOUT_MS,
    });
    return (JSON.parse(out) as Record<string, unknown>).BackendState === "Running";
  } catch {
    return false;
  }
}

function bgRefreshFunnelUrl(port: number): void {
  if (funnelUrlCache.refreshing) return;
  const bin: string | null = getTailscaleBin();
  if (!bin) return;
  funnelUrlCache.refreshing = true;
  execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, { windowsHide: true, timeout: PROBE_TIMEOUT_MS })
    .then(({ stdout }: { stdout: string }) => {
      try {
        const json: Record<string, unknown> = JSON.parse(stdout);
        const dnsName: string | undefined = ((json.Self as Record<string, unknown>)?.DNSName as string)?.replace(/\.$/, "");
        funnelUrlCache.value = dnsName ? `https://${dnsName}` : null;
      } catch { /* keep prev */ }
    })
    .catch(() => { /* keep prev */ })
    .finally(() => {
      funnelUrlCache.port = port;
      funnelUrlCache.fetchedAt = Date.now();
      funnelUrlCache.refreshing = false;
    });
}

/** Get actual funnel URL from Self.DNSName (sync, authoritative — avoids hostname-conflict suffix). */
function getActualFunnelUrl(): string | null {
  const bin: string | null = getTailscaleBin();
  if (!bin) return null;
  try {
    const out: string = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 5000,
    });
    const json: Record<string, unknown> = JSON.parse(out);
    const dnsName: string | undefined = ((json.Self as Record<string, unknown>)?.DNSName as string)?.replace(/\.$/, "");
    return dnsName ? `https://${dnsName}` : null;
  } catch { return null; }
}

/** Get funnel URL from tailscale status (cached, non-blocking) */
function getTailscaleFunnelUrl(port: number): string | null {
  if (Date.now() - funnelUrlCache.fetchedAt > PROBE_TTL_MS || funnelUrlCache.port !== port) {
    bgRefreshFunnelUrl(port);
  }
  return funnelUrlCache.value;
}

/**
 * Install tailscale.
 * - macOS + brew: brew install tailscale (no sudo needed)
 * - macOS no brew: download .pkg then sudo installer -pkg
 * - Linux: fetch install.sh, pipe to sudo -S sh via stdin
 * - Windows: download MSI via UAC-elevated PowerShell
 */
export async function installTailscale(sudoPassword: string, hostname: string, onProgress?: (msg: string) => void): Promise<{ success: boolean; authUrl?: string; alreadyLoggedIn?: boolean }> {
  const log: (msg: string) => void = onProgress || (() => {});
  if (IS_WINDOWS) {
    await installTailscaleWindows(log);
    return { success: true };
  }
  if (IS_MAC) await installTailscaleMac(sudoPassword, log);
  else await installTailscaleLinux(sudoPassword, log);

  log("Starting daemon...");
  await startDaemonWithPassword(sudoPassword);
  log("Logging in...");
  return startLogin(hostname);
}

function hasBrew(): boolean {
  try { execSync("which brew", { stdio: "ignore", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH } }); return true; } catch { return false; }
}

async function installTailscaleMac(sudoPassword: string, log: (msg: string) => void): Promise<void> {
  if (hasBrew()) {
    log("Installing via Homebrew...");
    await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
      const child: ChildProcess = spawn("brew", ["install", "tailscale"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH }
      });
      child.stdout!.on("data", (d: Buffer) => {
        const line: string = d.toString().trim();
        if (line) log(line);
      });
      child.stderr!.on("data", (d: Buffer) => {
        const line: string = d.toString().trim();
        if (line) log(line);
      });
      child.on("close", (c: number | null) => {
        if (c === 0) resolve();
        else reject(new Error(`brew install failed (code ${c})`));
      });
      child.on("error", reject);
    });
    return;
  }

  const pkgUrl: string = "https://pkgs.tailscale.com/stable/tailscale-latest.pkg";
  const pkgPath: string = path.join(os.tmpdir(), "tailscale.pkg");

  log("Downloading Tailscale package...");
  await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
    const child: ChildProcess = spawn("curl", ["-fL", "--progress-bar", pkgUrl, "-o", pkgPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stderr!.on("data", (d: Buffer) => {
      const line: string = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c: number | null) => {
      if (c === 0) resolve();
      else reject(new Error("Download failed"));
    });
    child.on("error", reject);
  });

  log("Installing package...");
  await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
    const child: ChildProcess = spawn("sudo", ["-S", "installer", "-pkg", pkgPath, "-target", "/"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr: string = "";
    child.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.stdout!.on("data", (d: Buffer) => {
      const line: string = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c: number | null) => {
      try { execSync(`rm -f ${pkgPath}`, { stdio: "ignore", windowsHide: true }); } catch { /* ignore */ }
      if (c === 0) resolve();
      else {
        const msg: string = (stderr.includes("incorrect password") || stderr.includes("Sorry"))
          ? "Wrong sudo password"
          : stderr || `Exit code ${c}`;
        reject(new Error(msg));
      }
    });
    child.on("error", reject);
    child.stdin!.write(`${sudoPassword}\n`);
    child.stdin!.end();
  });
}

async function installTailscaleLinux(sudoPassword: string, log: (msg: string) => void): Promise<void> {
  if (typeof sudoPassword !== "string" || sudoPassword.includes("\n")) {
    throw new Error("Invalid sudo password");
  }
  log("Downloading install script...");
  return new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
    const curlChild: ChildProcess = spawn("curl", ["-fsSL", "https://tailscale.com/install.sh"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let scriptContent: string = "";
    let curlErr: string = "";
    curlChild.stdout!.on("data", (d: Buffer) => { scriptContent += d.toString(); });
    curlChild.stderr!.on("data", (d: Buffer) => { curlErr += d.toString(); });
    curlChild.on("exit", (code: number | null) => {
      if (code !== 0) return reject(new Error(`Failed to download install script: ${curlErr}`));
      log("Running install script...");
      const tmpScript: string = path.join(os.tmpdir(), `tailscale-install-${crypto.randomBytes(8).toString("hex")}.sh`);
      try {
        fs.writeFileSync(tmpScript, scriptContent, { mode: 0o700 });
      } catch (e: unknown) {
        return reject(new Error(`Failed to write install script: ${(e as Error).message}`));
      }
      const cleanup = (): void => { try { fs.unlinkSync(tmpScript); } catch {} };
      const child: ChildProcess = spawn("sudo", ["-S", "sh", tmpScript], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stderr: string = "";
      child.stdout!.on("data", (d: Buffer) => {
        const line: string = d.toString().trim();
        if (line) log(line);
      });
      child.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (c: number | null) => {
        cleanup();
        if (c === 0) resolve();
        else {
          const msg: string = (stderr.includes("incorrect password") || stderr.includes("Sorry"))
            ? "Wrong sudo password"
            : stderr || `Exit code ${c}`;
          reject(new Error(msg));
        }
      });
      child.on("error", (e: Error) => { cleanup(); reject(e); });
      child.stdin!.write(`${sudoPassword}\n`);
      child.stdin!.end();
    });
    curlChild.on("error", reject);
  });
}

async function installTailscaleWindows(log: (msg: string) => void): Promise<void> {
  const msiUrl: string = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi";
  const msiPath: string = path.join(os.tmpdir(), "tailscale-setup.msi");

  log("Downloading Tailscale installer...");
  await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
    const child: ChildProcess = spawn("curl.exe", ["-L", "-#", "-o", msiPath, msiUrl], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let lastPct: string = "";
    child.stderr!.on("data", (d: Buffer) => {
      const text: string = d.toString();
      const match: RegExpMatchArray | null = text.match(/(\d+\.\d)%/);
      if (match && match[1] !== lastPct) {
        lastPct = match[1];
        log(`Downloading... ${lastPct}%`);
      }
    });
    child.on("close", (c: number | null) => c === 0 ? resolve() : reject(new Error("Download failed")));
    child.on("error", reject);
  });

  log("Installing Tailscale (UAC prompt may appear)...");
  await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
    const args: string = `'/i','${msiPath}','TS_NOLAUNCH=true','/quiet','/norestart'`;
    const child: ChildProcess = spawn("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Start-Process msiexec -ArgumentList ${args} -Verb RunAs -Wait`
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stderr!.on("data", (d: Buffer) => { const l: string = d.toString().trim(); if (l) log(l); });
    child.on("close", (c: number | null) => {
      try { fs.unlinkSync(msiPath); } catch { /* ignore */ }
      c === 0 ? resolve() : reject(new Error(`msiexec failed (code ${c})`));
    });
    child.on("error", reject);
  });

  log("Verifying installation...");
  const maxWait: number = 10000;
  const start: number = Date.now();
  while (Date.now() - start < maxWait) {
    if (fs.existsSync(WINDOWS_TAILSCALE_BIN)) {
      log("Installation complete.");
      return;
    }
    await new Promise<void>((r: () => void) => setTimeout(r, 1000));
  }
  throw new Error("Installation finished but tailscale.exe not found");
}

// Self-heal: if state dir/files were previously created by root (e.g. legacy sudo daemon),
// reclaim ownership recursively so the user-mode daemon can read/write state files.
async function ensureUserOwnedDir(dir: string): Promise<void> {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
    const uid: number = process.getuid!();
    const gid: number = process.getgid!();

    const needsChown: boolean = (() => {
      const stack: string[] = [dir];
      while (stack.length) {
        const cur: string = stack.pop()!;
        try {
          const st: fs.Stats = fs.statSync(cur);
          if (st.uid !== uid) return true;
          if (st.isDirectory()) {
            for (const name of fs.readdirSync(cur)) stack.push(path.join(cur, name));
          }
        } catch { /* ignore */ }
      }
      return false;
    })();

    if (!needsChown) return;

    try {
      execSync(`chown -R ${uid}:${gid} "${dir}"`, { stdio: "ignore", timeout: 3000 });
    } catch {
      try { execSync(`sudo -n chown -R ${uid}:${gid} "${dir}"`, { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** Check if running daemon uses TUN mode (Funnel TLS requires TUN). */
function isDaemonTunMode(): boolean | null {
  try {
    const ps: string = execSync(`pgrep -af "tailscaled.*${TAILSCALE_SOCKET}"`, { encoding: "utf8", timeout: 2000 }).trim();
    if (!ps) return null;
    return !ps.includes("--tun=userspace-networking");
  } catch { return null; }
}

/** Daemon process alive (independent of funnel state) — mirrors cloudflared PID check semantic. */
export function isDaemonAlive(): boolean {
  return isDaemonTunMode() !== null;
}

/**
 * Start tailscaled.
 * - With sudoPassword: TUN mode (root) → Funnel TLS works
 * - Without: userspace-networking fallback (no sudo, but Funnel TLS unstable)
 * State always lives in ~/.9router/tailscale/ via --statedir.
 */
export async function startDaemonWithPassword(sudoPassword: string): Promise<void> {
  if (IS_WINDOWS) {
    const bin: string | null = getTailscaleBin();
    console.log("[Tailscale] win: net start Tailscale");
    try { execSync("net start Tailscale", { stdio: "ignore", windowsHide: true, timeout: 10000 }); }
    catch { /* may need admin, or already running */ }
    if (!bin) return;
    for (let i = 0; i < 20; i++) {
      try {
        const out: string = execSync(`"${bin}" status --json`, { encoding: "utf8", windowsHide: true, timeout: 2000 });
        const j: Record<string, unknown> = JSON.parse(out);
        if (j.BackendState && j.BackendState !== "NoState") {
          console.log(`[Tailscale] win: BackendState=${j.BackendState} after ${i*500}ms`);
          return;
        }
      } catch { /* daemon not ready */ }
      await new Promise<void>((r: () => void) => setTimeout(r, 500));
    }
    console.log("[Tailscale] win: BackendState still NoState after poll");
    return;
  }

  const currentMode: boolean | null = isDaemonTunMode();
  const wantTun: boolean = sudoPassword ? true : currentMode === true;

  if (currentMode !== null && currentMode === wantTun) {
    try {
      const bin: string = getTailscaleBin() || "tailscale";
      execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
        stdio: "ignore", windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH }, timeout: 3000
      });
      return;
    } catch { /* unresponsive, restart below */ }
  }

  try { execSync(`pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
  if (sudoPassword) {
    try { await execWithPassword(`pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, sudoPassword); } catch { /* ignore */ }
  } else {
    try { execSync(`sudo -n pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
  }
  await new Promise<void>((r: () => void) => setTimeout(r, 1500));

  await ensureUserOwnedDir(TAILSCALE_DIR);

  const tailscaledBin: string = IS_MAC ? "/usr/local/bin/tailscaled" : "tailscaled";
  const daemonArgs: string[] = [
    `--socket=${TAILSCALE_SOCKET}`,
    `--statedir=${TAILSCALE_DIR}`,
  ];
  if (!wantTun) daemonArgs.push("--tun=userspace-networking");

  if (wantTun) {
    const child: ChildProcess = spawn("sudo", ["-S", tailscaledBin, ...daemonArgs], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    child.stdin!.write(`${sudoPassword}\n`);
    child.stdin!.end();
    child.unref();
  } else {
    const child: ChildProcess = spawn(tailscaledBin, daemonArgs, {
      detached: true,
      stdio: "ignore",
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    child.unref();
  }

  await new Promise<void>((r: () => void) => setTimeout(r, 3000));
}

/** Best-effort: ensure daemon running (used for login flow) */
function ensureDaemon(): void {
  startDaemonWithPassword("").catch(() => {});
}

/** Read AuthURL from `tailscale status --json` (Win exposes it there, not stdout). */
function getAuthUrlFromStatus(): string | null {
  const bin: string | null = getTailscaleBin();
  if (!bin) return null;
  try {
    const out: string = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8", windowsHide: true, timeout: 2000
    });
    const j: Record<string, unknown> = JSON.parse(out);
    if (j.AuthURL) return j.AuthURL as string;
    return null;
  } catch { return null; }
}

interface LoginResult {
  authUrl?: string;
  alreadyLoggedIn?: boolean;
}

/**
 * Run `tailscale up` and capture the auth URL for browser login.
 * Resolves with { authUrl } or { alreadyLoggedIn: true }.
 * On Windows, AuthURL comes from `status --json` (not stdout) — must poll status.
 */
export function startLogin(hostname: string): Promise<LoginResult> {
  const bin: string | null = getTailscaleBin();
  if (!bin) return Promise.reject(new Error("Tailscale not installed"));

  return new Promise<LoginResult>((resolve: (value: LoginResult) => void, reject: (reason: Error) => void) => {
    ensureDaemon();

    if (isTailscaleLoggedIn()) {
      resolve({ alreadyLoggedIn: true });
      return;
    }

    const args: string[] = tsArgs("up", "--accept-routes");
    if (hostname) args.push(`--hostname=${hostname}`);
    const child: ChildProcess = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true
    });

    let resolved: boolean = false;
    let output: string = "";

    const parseAuthUrl = (text: string): string | null => {
      const match: RegExpMatchArray | null = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    };

    const finishWithUrl = (url: string, source: string): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      console.log(`[Tailscale] login authUrl detected (${source})`);
      child.unref();
      resolve({ authUrl: url });
    };

    const statusPoll: ReturnType<typeof setInterval> = setInterval(() => {
      if (resolved) return;
      const url: string | null = getAuthUrlFromStatus();
      if (url) finishWithUrl(url, "status");
    }, 500);

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(statusPoll);
      child.unref();
      const url: string | null = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) resolve({ authUrl: url });
      else reject(new Error("tailscale up timed out without auth URL"));
    }, 15000);

    const handleData = (data: Buffer): void => {
      output += data.toString();
      const url: string | null = parseAuthUrl(output);
      if (url) finishWithUrl(url, "stdout");
    };

    child.stdout!.on("data", handleData);
    child.stderr!.on("data", handleData);

    child.on("error", (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      console.error(`[Tailscale] login spawn error: ${err.message}`);
      reject(err);
    });

    child.on("exit", (code: number | null) => {
      if (resolved) return;
      console.log(`[Tailscale] login exit code=${code}`);
      const url: string | null = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) {
        finishWithUrl(url, "exit");
        return;
      }
      if (isTailscaleLoggedIn()) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(statusPoll);
        resolve({ alreadyLoggedIn: true });
        return;
      }
    });
  });
}

interface FunnelResult {
  tunnelUrl: string;
  funnelNotEnabled?: boolean;
  enableUrl?: string;
}

/** Start tailscale funnel for the given port */
export async function startFunnel(port: number): Promise<FunnelResult> {
  const bin: string | null = getTailscaleBin();
  if (!bin) throw new Error("Tailscale not installed");

  try { execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true }); } catch (e: unknown) { /* ignore */ }

  return new Promise<FunnelResult>((resolve: (value: FunnelResult) => void, reject: (reason: Error) => void) => {
    const child: ChildProcess = spawn(bin, tsArgs("funnel", "--bg", `${port}`), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let resolved: boolean = false;
    let output: string = "";

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const url: string | null = getActualFunnelUrl() || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`));
    }, 30000);

    const parseFunnelUrl = (): string | null => getActualFunnelUrl();

    let funnelNotEnabled: boolean = false;

    const handleData = (data: Buffer): void => {
      output += data.toString();

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      if (funnelNotEnabled && !resolved) {
        const enableMatch: RegExpMatchArray | null = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          resolved = true;
          clearTimeout(timeout);
          child.kill();
          resolve({ tunnelUrl: "", funnelNotEnabled: true, enableUrl: enableMatch[0] });
          return;
        }
      }

      const url: string | null = parseFunnelUrl();
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelUrl: url });
      }
    };

    child.stdout!.on("data", handleData);
    child.stderr!.on("data", handleData);

    child.on("exit", (code: number | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.log(`[Tailscale] funnel exit code=${code} output="${output.trim().slice(0, 200)}"`);
      const url: string | null = parseFunnelUrl() || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`));
    });

    child.on("error", (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Provision TLS cert for funnel domain (required before Funnel serves HTTPS). Best-effort. */
export async function provisionCert(hostname: string): Promise<void> {
  const bin: string | null = getTailscaleBin();
  if (!bin || !hostname) return;
  const certsDir: string = path.join(TAILSCALE_DIR, "certs");
  fs.mkdirSync(certsDir, { recursive: true });
  const certFile: string = path.join(certsDir, `${hostname}.crt`);
  const keyFile: string = path.join(certsDir, `${hostname}.key`);
  try {
    await execAsync(
      `"${bin}" ${SOCKET_FLAG.join(" ")} cert --cert-file "${certFile}" --key-file "${keyFile}" "${hostname}"`,
      { windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: 30000 }
    );
    console.log(`[Tailscale] cert provisioned for ${hostname}`);
  } catch (e: unknown) {
    console.warn(`[Tailscale] cert provision failed (non-fatal): ${(e as Error).message}`);
  }
}

/** Stop tailscale funnel */
export function stopFunnel(): void {
  const bin: string | null = getTailscaleBin();
  if (!bin) return;
  try { execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true }); } catch (e: unknown) { /* ignore */ }
}

/** Kill tailscaled daemon (runs as root, needs sudo) */
async function stopDaemon(sudoPassword: string): Promise<void> {
  try { execSync("pkill -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { /* ignore */ }

  try { execSync("pgrep -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 2000 }); } catch { return; }

  if (!IS_WINDOWS) {
    try { await execWithPassword("pkill -x tailscaled", sudoPassword || ""); } catch { /* ignore */ }
  }

  try { if (fs.existsSync(TAILSCALE_SOCKET)) fs.unlinkSync(TAILSCALE_SOCKET); } catch { /* ignore */ }
}
