import { exec, spawn, execSync } from "child_process";
import crypto from "crypto";

const IS_WIN: boolean = process.platform === "win32";

/** True when `sudo` exists (e.g. missing on minimal Docker images like Alpine). */
function isSudoAvailable(): boolean {
  if (IS_WIN) return false;
  try {
    execSync("command -v sudo", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute command with sudo password via stdin (macOS/Linux only).
 * Without sudo in PATH (containers), runs via sh — same user, no elevation.
 */
export function execWithPassword(command: string, password: string | null): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const useSudo: boolean = isSudoAvailable();
    const child = useSudo
      ? spawn("sudo", ["-S", "sh", "-c", command], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let stdout: string = "";
    let stderr: string = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d; });
    child.stderr.on("data", (d: Buffer) => { stderr += d; });

    child.on("close", (code: number | null) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    if (useSudo) {
      child.stdin?.write(`${password}\n`);
      child.stdin?.end();
    }
  });
}

// ─── Password cache & encryption (shared by Tailscale and other elevated ops) ─

const ENCRYPT_ALGO = "aes-256-gcm" as const;
const ENCRYPT_SALT: string = "9router-elevated-pwd";

export function getCachedPassword(): string | null {
  return (globalThis as unknown as Record<string, unknown>).__elevatedSudoPassword as string || null;
}

function setCachedPassword(pwd: string | null): void {
  (globalThis as unknown as Record<string, unknown>).__elevatedSudoPassword = pwd;
}

function deriveKey(): Buffer {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime conditional: machine-id is optional, require allows graceful fallback
    const { machineIdSync } = require("node-machine-id") as { machineIdSync: () => string };
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

type SettingsGetter = (() => Promise<Record<string, unknown>>) | null;
type SettingsUpdater = ((updates: Record<string, unknown>) => Promise<Record<string, unknown>>) | null;

let _getSettings: SettingsGetter = null;
let _updateSettings: SettingsUpdater = null;

export function initDbHooks(getSettingsFn: SettingsGetter, updateSettingsFn: SettingsUpdater): void {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

export async function loadEncryptedPassword(): Promise<string | null> {
  if (!_getSettings) return null;
  try {
    const settings: Record<string, unknown> = await _getSettings();
    // Legacy DB key name kept for backward compatibility with existing installations
    const encrypted = settings.mitmSudoEncrypted;
    if (typeof encrypted !== "string" || !encrypted) return null;
    return decryptPassword(encrypted);
  } catch {
    return null;
  }
}
