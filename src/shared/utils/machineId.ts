import { machineIdSync } from "node-machine-id";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";

const MACHINE_ID_FILE: string = path.join(DATA_DIR, "machine-id");
const AUTH_DIR: string = path.join(DATA_DIR, "auth");
const CLI_SECRET_FILE: string = path.join(AUTH_DIR, "cli-secret");
const CLI_AUTH_SALT: string = "9r-cli-auth";

let cachedRawId: string | null = null;
let cachedCliSecret: string | null = null;

// Persist raw machine ID to file → guarantees CLI/server/middleware see same value
// even when machineIdSync fails or returns inconsistent values across runtimes.
function loadRawMachineId(): string {
  if (cachedRawId) return cachedRawId;
  try {
    cachedRawId = fs.readFileSync(MACHINE_ID_FILE, "utf8").trim();
    if (cachedRawId) return cachedRawId;
  } catch {}
  try {
    cachedRawId = machineIdSync();
  } catch {
    cachedRawId = crypto.randomUUID();
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MACHINE_ID_FILE, cachedRawId, { mode: 0o600 });
  } catch {}
  return cachedRawId;
}

// Random secret persisted on first run → unpredictable CLI token even when machineId leaks.
function loadCliSecret(): string {
  if (cachedCliSecret) return cachedCliSecret;
  try {
    cachedCliSecret = fs.readFileSync(CLI_SECRET_FILE, "utf8").trim();
    if (cachedCliSecret) return cachedCliSecret;
  } catch {}
  cachedCliSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(CLI_SECRET_FILE, cachedCliSecret, { mode: 0o600 });
  } catch {}
  return cachedCliSecret;
}

export async function getConsistentMachineId(salt: string | null = null): Promise<string> {
  const saltValue: string = salt || process.env.MACHINE_ID_SALT || "endpoint-proxy-salt";
  const raw = loadRawMachineId();
  const extra: string = saltValue === CLI_AUTH_SALT ? loadCliSecret() : "";
  return crypto.createHash("sha256").update(raw + saltValue + extra).digest("hex").substring(0, 16);
}

async function getRawMachineId(): Promise<string> {
  return loadRawMachineId();
}

/**
 * Check if we're running in browser or server environment
 */
function isBrowser(): boolean {
  return typeof window !== "undefined";
}
