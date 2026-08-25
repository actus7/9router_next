import fs from "fs";
import path from "path";
import https from "https";
import os from "os";
import { execSync, spawn, ChildProcess } from "child_process";
import { savePid, loadPid, clearPid } from "./pid";
import { DATA_DIR } from "@/lib/dataDir";

const BIN_DIR: string = path.join(DATA_DIR, "bin");
const BINARY_NAME: string = "cloudflared";
const IS_WINDOWS: boolean = os.platform() === "win32";
const BIN_NAME: string = IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME;
const BIN_PATH: string = path.join(BIN_DIR, BIN_NAME);
const POWERSHELL_HIDDEN_COMMAND: string = "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command";
const DEFAULT_QUICK_TUNNEL_PROTOCOL: string = "http2";
const QUICK_TUNNEL_PROTOCOLS: Set<string> = new Set(["http2", "quic", "auto"]);

const GITHUB_BASE_URL: string = "https://github.com/cloudflare/cloudflared/releases/latest/download";

const PLATFORM_MAPPINGS: Record<string, Record<string, string>> = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-arm64.tgz"
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe",
    ia32: "cloudflared-windows-386.exe",
    arm64: "cloudflared-windows-386.exe"
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64"
  }
};

const PLATFORM_FALLBACK: Record<string, string> = {
  darwin: "cloudflared-darwin-amd64.tgz",
  win32: "cloudflared-windows-386.exe",
  linux: "cloudflared-linux-amd64"
};

function getDownloadUrl(): string {
  const platform: string = os.platform();
  const arch: string = os.arch();

  const platformMapping: Record<string, string> | undefined = PLATFORM_MAPPINGS[platform];
  if (!platformMapping) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const binaryName: string = platformMapping[arch] || PLATFORM_FALLBACK[platform];
  return `${GITHUB_BASE_URL}/${binaryName}`;
}

interface DownloadState {
  downloading: boolean;
  progress: number;
}

const dlState: DownloadState = { downloading: false, progress: 0 };

export function getDownloadStatus(): DownloadState {
  return { downloading: dlState.downloading, progress: dlState.progress };
}

function downloadFile(url: string, dest: string): Promise<string> {
  return new Promise<string>((resolve: (value: string) => void, reject: (reason: Error) => void) => {
    const file: fs.WriteStream = fs.createWriteStream(dest);

    https.get(url, (response: https.IncomingMessage) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode!)) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalBytes: number = parseInt(response.headers["content-length"] as string, 10) || 0;
      let receivedBytes: number = 0;
      dlState.downloading = true;
      dlState.progress = 0;

      response.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0) dlState.progress = Math.round((receivedBytes / totalBytes) * 100);
      });

      response.pipe(file);

      file.on("finish", () => {
        dlState.downloading = false;
        dlState.progress = 100;
        file.close(() => resolve(dest));
      });

      file.on("error", (err: Error) => {
        dlState.downloading = false;
        dlState.progress = 0;
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
    }).on("error", (err: Error) => {
      dlState.downloading = false;
      dlState.progress = 0;
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

const MIN_BINARY_SIZE: number = 1024 * 1024; // 1MB - cloudflared is ~30MB+

function isValidBinary(filePath: string): boolean {
  try {
    const stat: fs.Stats = fs.statSync(filePath);
    if (stat.size < MIN_BINARY_SIZE) return false;
    const fd: number = fs.openSync(filePath, "r");
    const buf: Buffer = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic: string = buf.toString("hex");
    if (IS_WINDOWS) return magic.startsWith("4d5a"); // PE (MZ)
    if (os.platform() === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    return magic.startsWith("7f454c46"); // ELF (Linux)
  } catch {
    return false;
  }
}

let downloadPromise: Promise<string> | null = null;

export async function ensureCloudflared(): Promise<string> {
  if (downloadPromise) return downloadPromise;
  downloadPromise = _ensureCloudflared().finally(() => { downloadPromise = null; });
  return downloadPromise;
}

async function _ensureCloudflared(): Promise<string> {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const tmpPath: string = `${BIN_PATH}.tmp`;
  if (fs.existsSync(tmpPath)) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (fs.existsSync(BIN_PATH)) {
    if (!isValidBinary(BIN_PATH)) {
      console.log("[cloudflared] Invalid binary detected, re-downloading...");
      fs.unlinkSync(BIN_PATH);
    } else {
      if (!IS_WINDOWS) fs.chmodSync(BIN_PATH, "755");
      return BIN_PATH;
    }
  }

  const url: string = getDownloadUrl();
  const isArchive: boolean = url.endsWith(".tgz");
  const downloadDest: string = isArchive ? path.join(BIN_DIR, "cloudflared.tgz.tmp") : tmpPath;

  await downloadFile(url, downloadDest);

  if (isArchive) {
    execSync(`tar -xzf "${downloadDest}" -C "${BIN_DIR}"`, { stdio: "pipe", windowsHide: true });
    fs.unlinkSync(downloadDest);
  } else {
    fs.renameSync(downloadDest, BIN_PATH);
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(BIN_PATH, "755");
  }

  return BIN_PATH;
}

let cloudflaredProcess: ChildProcess | null = null;
let unexpectedExitHandler: (() => void) | null = null;
let intentionalKill: boolean = false;

export function setUnexpectedExitHandler(handler: (() => void) | null): void {
  unexpectedExitHandler = handler;
}

interface SpawnResult {
  child: ChildProcess;
  tunnelUrl: string;
}

export async function spawnCloudflared(tunnelToken: string): Promise<ChildProcess> {
  const binaryPath: string = await ensureCloudflared();

  const child: ChildProcess = spawn(binaryPath, ["tunnel", "run", "--dns-resolver-addrs", "1.1.1.1:53", "--token", tunnelToken], {
    detached: false,
    windowsHide: true,
    cwd: os.tmpdir(),
    stdio: ["ignore", "pipe", "pipe"]
  });

  cloudflaredProcess = child;
  savePid(child.pid!);

  return new Promise<ChildProcess>((resolve: (value: ChildProcess) => void, reject: (reason: Error) => void) => {
    let connectionCount: number = 0;
    let resolved: boolean = false;
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      resolved = true;
      resolve(child);
    }, 90000);

    const handleLog = (data: Buffer): void => {
      const msg: string = data.toString();
      const matches: RegExpMatchArray | null = msg.match(/Registered tunnel connection/g);
      if (matches) {
        connectionCount += matches.length;
        if (connectionCount >= 4 && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    };

    child.stdout!.on("data", handleLog);
    child.stderr!.on("data", handleLog);

    child.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      if (cloudflaredProcess === child) cloudflaredProcess = null;
      clearPid(child.pid!);
      const wasConnected: boolean = resolved;
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        let stderrOutput: string = "";
        if (child.stderr && !child.stderr.destroyed) {
          stderrOutput = " Check cloudflared logs for details.";
        }
        if (code === 1) {
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput} Ensure your tunnel token is valid and network is reachable.`));
        } else if (code === 2) {
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput} Check if required arguments are correct.`));
        } else {
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput}`));
        }
        return;
      }
      if (intentionalKill) { intentionalKill = false; return; }
      if (wasConnected && unexpectedExitHandler) unexpectedExitHandler();
    });
  });
}

export async function spawnQuickTunnel(localPort: number, onUrlUpdate?: (url: string) => void): Promise<SpawnResult> {
  const binaryPath: string = await ensureCloudflared();

  const configDir: string = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-quick-"));
  const configPath: string = path.join(configDir, "config.yml");
  fs.writeFileSync(configPath, "# quick-tunnel config placeholder\n", "utf8");

  let isCleaned: boolean = false;
  const cleanup = (): void => {
    if (isCleaned) return;
    isCleaned = true;
    try {
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch (e: unknown) { /* ignore */ }
  };

  const requestedProtocol: string = String(process.env.TUNNEL_TRANSPORT_PROTOCOL || process.env.CLOUDFLARED_PROTOCOL || DEFAULT_QUICK_TUNNEL_PROTOCOL).trim().toLowerCase();
  const tunnelProtocol: string = QUICK_TUNNEL_PROTOCOLS.has(requestedProtocol) ? requestedProtocol : DEFAULT_QUICK_TUNNEL_PROTOCOL;
  const child: ChildProcess = spawn(binaryPath, ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--config", configPath, "--no-autoupdate", "--retries", "99"], {
    detached: false,
    windowsHide: true,
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      TUNNEL_TRANSPORT_PROTOCOL: tunnelProtocol,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  cloudflaredProcess = child;
  savePid(child.pid!);

  return new Promise<SpawnResult>((resolve: (value: SpawnResult) => void, reject: (reason: Error) => void) => {
    let resolved: boolean = false;
    let logTail: string = "";

    function getQuickTunnelUrlFromLog(message: string): string | null {
      const regex: RegExp = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi;
      const candidates: string[] = [];

      for (const match of message.matchAll(regex)) {
        const host: string = match[1];
        if (host === "api") continue;
        candidates.push(`https://${host}.trycloudflare.com`);
      }

      if (!candidates.length) return null;
      return candidates[candidates.length - 1];
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error(`Quick tunnel timed out. Last log: ${logTail.slice(-800) || "(empty)"}`));
    }, 90000);

    let lastUrl: string | null = null;

    const handleLog = (data: Buffer): void => {
      const msg: string = data.toString();
      logTail = (logTail + msg).slice(-4000);
      const tunnelUrl: string | null = getQuickTunnelUrlFromLog(msg);
      if (!tunnelUrl) return;

      if (!resolved) {
        resolved = true;
        lastUrl = tunnelUrl;
        clearTimeout(timeout);
        cleanup();
        console.log(`[Tunnel] cloudflared URL: ${tunnelUrl}`);
        resolve({ child, tunnelUrl });
        return;
      }

      if (tunnelUrl !== lastUrl) {
        console.log(`[Tunnel] cloudflared URL changed: ${tunnelUrl}`);
        lastUrl = tunnelUrl;
        if (onUrlUpdate) onUrlUpdate(tunnelUrl);
      }
    };

    child.stdout!.on("data", handleLog);
    child.stderr!.on("data", handleLog);

    child.on("error", (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      if (cloudflaredProcess === child) cloudflaredProcess = null;
      clearPid(child.pid!);
      if (intentionalKill) {
        intentionalKill = false;
        clearTimeout(timeout);
        cleanup();
        if (!resolved) { resolved = true; reject(new Error("cloudflared killed")); }
        return;
      }
      console.log(`[Tunnel] cloudflared exit code=${code} signal=${signal}`);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        const tail: string = logTail.slice(-600).trim() || "(empty)";
        if (code === 1) {
          reject(new Error(`cloudflared quick tunnel exited (code 1). Common causes: (1) outbound port 7844 (TCP/UDP) blocked, (2) TryCloudflare service issue, (3) cannot reach 127.0.0.1:${localPort}, (4) protocol (http2/quic) blocked by network. Last log: ${tail}`));
        } else if (code === 2) {
          reject(new Error(`cloudflared exited (code 2). Bad arguments. Last log: ${tail}`));
        } else {
          reject(new Error(`cloudflared exited (code ${code}). Last log: ${tail}`));
        }
        return;
      }
      if (unexpectedExitHandler) unexpectedExitHandler();
      cleanup();
    });
  });
}

function killCloudflaredByPort(port: number): void {
  if (!port) return;
  try {
    if (IS_WINDOWS) {
      const psCmd: string = `Get-CimInstance Win32_Process -Filter \\"Name='cloudflared.exe'\\" | Where-Object { $_.CommandLine -match ':${port}(\\D|$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      execSync(`${POWERSHELL_HIDDEN_COMMAND} "${psCmd}"`, { stdio: "ignore", windowsHide: true });
    } else {
      execSync(`pkill -f "cloudflared.*:${port}([^0-9]|$)" 2>/dev/null || true`, { stdio: "ignore", windowsHide: true });
    }
  } catch (e: unknown) { /* ignore */ }
}

export function killCloudflared(localPort: number): void {
  intentionalKill = true;
  if (cloudflaredProcess) {
    try {
      cloudflaredProcess.kill();
    } catch (e: unknown) { /* ignore */ }
    cloudflaredProcess = null;
  }

  const pid: number | null = loadPid();
  if (pid) {
    try {
      process.kill(pid);
    } catch (e: unknown) { /* ignore */ }
    clearPid();
  }

  killCloudflaredByPort(localPort);
}

export function isCloudflaredRunning(): boolean {
  const pid: number | null = loadPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return false;
  }
}
