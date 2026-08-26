// JSON cache for mitmAlias — read by standalone MITM server (no SQLite native binding).
// Source of truth = SQLite kv['mitmAlias']. JSON is a read-replica synced on app start
// and after every UI write.
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR: string = process.env.DATA_DIR
  || (process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
    : path.join(os.homedir(), ".9router"));

const CACHE_FILE: string = path.join(DATA_DIR, "mitm", "aliases.json");

function writeAtomic(data: Record<string, unknown>): void {
  const dir: string = path.dirname(CACHE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp: string = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, CACHE_FILE);
}

// Sync entire mitmAlias map from DB → JSON file
export async function syncToJson(): Promise<void> {
  try {
    const { getMitmAlias } = await import("@/lib/db/repos/aliasRepo");
    const all: Record<string, unknown> = await getMitmAlias();
    writeAtomic(all || {});
  } catch (e: any) {
    console.error("[mitmAliasCache] sync failed:", e.message);
  }
}

// Update cache for a single tool after UI saves to DB
export function writeAliasForTool(tool: string, mappings: Record<string, unknown>): void {
  try {
    let current: Record<string, unknown> = {};
    if (fs.existsSync(CACHE_FILE)) {
      try { current = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { /* corrupted → reset */ }
    }
    current[tool] = mappings || {};
    writeAtomic(current);
  } catch (e: any) {
    console.error("[mitmAliasCache] write failed:", e.message);
  }
}
