// ESM reader for MITM standalone process. Reads mitmAlias from JSON cache
// at $DATA_DIR/mitm/aliases.json (synced by app from SQLite on startup + writes).
// JSON-only: no SQLite native binding required in MITM bundle.
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./paths";

const CACHE_FILE: string = path.join(DATA_DIR, "mitm", "aliases.json");

interface MitmAliasMap {
  [toolName: string]: Record<string, string> | undefined;
}

function readCache(): MitmAliasMap | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as MitmAliasMap;
  } catch { return null; }
}

function getMitmAlias(toolName: string): Record<string, string> | null {
  const all = readCache();
  return all?.[toolName] || null;
}

export { getMitmAlias };
