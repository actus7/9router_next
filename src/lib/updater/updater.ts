// Standalone detached updater process.
// Spawns `npm i -g <pkg>@latest`, exposes progress via tiny HTTP server.
// Survives after parent Next server exits (detached + unref by spawner).

import { spawn, ChildProcess } from "child_process";
import http from "http";
import net from "net";
import path from "path";
import fs from "fs";
import os from "os";

const packageName: string = process.env.UPDATER_PKG_NAME || "9router";
const port: number = parseInt(process.env.UPDATER_PORT || "20129", 10);
const tailLines: number = parseInt(process.env.UPDATER_TAIL_LINES || "8", 10);
const maxRetries: number = parseInt(process.env.UPDATER_RETRIES || "3", 10);
const retryDelayMs: number = parseInt(process.env.UPDATER_RETRY_DELAY_MS || "5000", 10);
const lingerMs: number = parseInt(process.env.UPDATER_LINGER_MS || "30000", 10);
const waitMinMs: number = parseInt(process.env.UPDATER_WAIT_MIN_MS || "3000", 10);
const waitMaxMs: number = parseInt(process.env.UPDATER_WAIT_MAX_MS || "15000", 10);
const waitCheckMs: number = parseInt(process.env.UPDATER_WAIT_CHECK_MS || "500", 10);
const appPort: number = parseInt(process.env.UPDATER_APP_PORT || "20128", 10);

// Data directory (match mitm/paths.js logic)
function getDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}
const updateDir: string = path.join(getDataDir(), "update");
try { fs.mkdirSync(updateDir, { recursive: true }); } catch { /* best effort */ }
const statusFile: string = path.join(updateDir, "status.json");
const logFile: string = path.join(updateDir, "install.log");

interface UpdaterState {
  phase: string;
  packageName: string;
  startedAt: number;
  finishedAt: number | null;
  attempt: number;
  maxRetries: number;
  done: boolean;
  success: boolean;
  exitCode: number | null;
  error: string | null;
  logTail: string[];
}

const state: UpdaterState = {
  phase: "starting",
  packageName,
  startedAt: Date.now(),
  finishedAt: null,
  attempt: 0,
  maxRetries,
  done: false,
  success: false,
  exitCode: null,
  error: null,
  logTail: [],
};

function pushLog(line: string): void {
  const trimmed: string = line.replace(/\r?\n$/, "");
  if (!trimmed) return;
  state.logTail.push(trimmed);
  if (state.logTail.length > tailLines) state.logTail = state.logTail.slice(-tailLines);
  try { fs.appendFileSync(logFile, `${trimmed}\n`); } catch { /* best effort */ }
}

function persistStatus(): void {
  try { fs.writeFileSync(statusFile, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
}

function setPhase(phase: string): void {
  state.phase = phase;
  persistStatus();
}

// HTTP server exposing status (browser polls this while Next server is dead)
const server: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/update/status" || req.url === "/") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.on("error", (e: Error) => {
  state.error = `status server error: ${e.message}`;
  persistStatus();
});

server.listen(port, "127.0.0.1", () => {
  persistStatus();
  waitForAppExit().then(runInstall);
});

// Check if app port is still being listened on (= app server still alive)
function isAppPortBusy(): Promise<boolean> {
  return new Promise<boolean>((resolve: (value: boolean) => void) => {
    const socket: net.Socket = new net.Socket();
    const done = (busy: boolean): void => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(appPort, "127.0.0.1");
  });
}

// Wait for app process to fully exit before running npm (avoids Windows file-lock)
async function waitForAppExit(): Promise<void> {
  setPhase("waitingForExit");
  pushLog(`[updater] waiting for app to exit (min ${Math.round(waitMinMs / 1000)}s)...`);

  await sleep(waitMinMs);

  const deadline: number = Date.now() + (waitMaxMs - waitMinMs);
  while (Date.now() < deadline) {
    const busy: boolean = await isAppPortBusy();
    if (!busy) {
      pushLog(`[updater] app port :${appPort} is free, proceeding`);
      return;
    }
    await sleep(waitCheckMs);
  }
  pushLog(`[updater] timeout waiting for app, proceeding anyway`);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r: () => void) => setTimeout(r, ms));
}

function runInstall(): void {
  state.attempt += 1;
  setPhase("installing");
  pushLog(`[updater] attempt ${state.attempt}/${maxRetries} — npm i -g ${packageName} --prefer-online`);

  const isWin: boolean = process.platform === "win32";
  const cmd: string = isWin ? "npm.cmd" : "npm";
  const args: string[] = ["i", "-g", packageName, "--prefer-online"];

  const child: ChildProcess = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: isWin,
  });

  child.stdout!.on("data", (buf: Buffer) => {
    buf.toString().split(/\r?\n/).forEach(pushLog);
    persistStatus();
  });
  child.stderr!.on("data", (buf: Buffer) => {
    buf.toString().split(/\r?\n/).forEach(pushLog);
    persistStatus();
  });

  child.on("error", (e: Error) => {
    pushLog(`[updater] spawn error: ${e.message}`);
    finalize(false, null, e.message);
  });

  child.on("close", (code: number | null) => {
    pushLog(`[updater] npm exited with code ${code}`);
    if (code === 0) {
      finalize(true, code, null);
      return;
    }
    if (state.attempt < maxRetries) {
      pushLog(`[updater] retrying in ${Math.round(retryDelayMs / 1000)}s...`);
      setTimeout(runInstall, retryDelayMs);
      return;
    }
    finalize(false, code, `Install failed after ${maxRetries} attempts`);
  });
}

function openBrowser(url: string): void {
  const platform: string = process.platform;
  const cmd: string = platform === "darwin" ? `open "${url}"`
    : platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  try { spawn(cmd, { shell: true, detached: true, stdio: "ignore" }).unref(); } catch { /* ignore */ }
}

// Wait until app port is listening (server alive again), then open dashboard
async function waitForAppAndOpenBrowser(): Promise<void> {
  const deadline: number = Date.now() + 30000;
  while (Date.now() < deadline) {
    const busy: boolean = await isAppPortBusy();
    if (busy) {
      openBrowser(`http://localhost:${appPort}/dashboard`);
      pushLog(`[updater] app ready, opened dashboard`);
      return;
    }
    await sleep(1000);
  }
  pushLog(`[updater] app not responding within 30s, skip browser open`);
}

function relaunchApp(): void {
  if (process.env.UPDATER_RELAUNCH !== "1") return;
  const cmd: string | undefined = process.env.UPDATER_RELAUNCH_CMD;
  if (!cmd) return;
  let args: string[] = [];
  try { args = JSON.parse(process.env.UPDATER_RELAUNCH_ARGS || "[]"); } catch { /* noop */ }
  const isWin: boolean = process.platform === "win32";
  try {
    const child: ChildProcess = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: isWin,
      env: { ...process.env, UPDATER_RELAUNCH: "", UPDATER_RELAUNCH_CMD: "", UPDATER_RELAUNCH_ARGS: "" },
    });
    child.unref();
    pushLog(`[updater] relaunched: ${cmd} ${args.join(" ")} (pid=${child.pid})`);
    waitForAppAndOpenBrowser();
  } catch (e: unknown) {
    pushLog(`[updater] relaunch failed: ${(e as Error).message}`);
  }
}

function finalize(success: boolean, exitCode: number | null, error: string | null): void {
  state.done = true;
  state.success = success;
  state.exitCode = exitCode;
  state.error = error;
  state.finishedAt = Date.now();
  setPhase(success ? "done" : "error");
  if (success) relaunchApp();
  setTimeout(() => {
    try { server.close(); } catch { /* ignore */ }
    process.exit(success ? 0 : 1);
  }, lingerMs);
}
