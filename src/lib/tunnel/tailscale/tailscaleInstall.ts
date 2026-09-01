import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execSync, spawn, type ChildProcess } from "child_process";

const IS_MAC = os.platform() === "darwin";
const IS_WINDOWS = os.platform() === "win32";
const WINDOWS_TAILSCALE_BIN = "C:\\Program Files\\Tailscale\\tailscale.exe";
const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;

export async function installTailscaleForCurrentPlatform(
  sudoPassword: string,
  log: (message: string) => void,
): Promise<boolean> {
  if (IS_WINDOWS) {
    await installTailscaleWindows(log);
    return true;
  }
  if (IS_MAC) await installTailscaleMac(sudoPassword, log);
  else await installTailscaleLinux(sudoPassword, log);
  return false;
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


