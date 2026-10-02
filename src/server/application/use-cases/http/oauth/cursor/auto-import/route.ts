import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createRequire } from "node:module";
import { CURSOR_STATE_DB_ENV, getCandidatePaths } from "./stateDbPaths";

const execFileAsync = promisify(execFile);

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];


/**
 * Extract tokens via better-sqlite3 (bundled dependency).
 * This is the preferred strategy — no external CLI required.
 */
function extractTokensViaBetterSqlite(dbPath: string) {
  // Resolved at runtime, on purpose. `better-sqlite3` is an optionalDependency
  // with a native build that does not compile everywhere, and a literal
  // require() here is a static import as far as the bundler is concerned — it
  // failed the whole production build on a machine where the optional install
  // had been skipped. Assembling the specifier keeps the resolution where it
  // belongs: at call time, inside the caller's try/catch, which already falls
  // through to the CLI strategy.
  const specifier: string = ["better", "sqlite3"].join("-");
  const Database = createRequire(import.meta.url)(specifier);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const query = (key: string) => {
    const row = db.prepare("SELECT value FROM itemTable WHERE key=? LIMIT 1").get(key);
    return row?.value || null;
  };

  const normalize = (value: unknown) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    const raw = query(key);
    if (raw) { accessToken = normalize(raw); break; }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    const raw = query(key);
    if (raw) { machineId = normalize(raw); break; }
  }

  db.close();
  return { accessToken, machineId };
}

/**
 * Extract tokens via sqlite3 CLI.
 * Fallback when better-sqlite3 native bindings are unavailable.
 */
async function extractTokensViaCLI(dbPath: string) {
  const normalize = (raw: string) => {
    const value = raw.trim();
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const query = async (sql: string) => {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      timeout: 10000,
    });
    return stdout.trim();
  };

  // Try each key in priority order
  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        accessToken = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        machineId = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  return { accessToken, machineId };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 * Strategy: better-sqlite3 → sqlite3 CLI → manual fallback
 */
export async function GET() {
  try {
    const platform = process.platform;
    const candidates = getCandidatePaths(platform);

    let dbPath = null;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        dbPath = candidate;
        break;
      } catch {
        // Try next candidate
      }
    }

    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error: `Cursor database not found. Checked locations:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`,
      });
    }

    // On Linux, verify Cursor is actually installed (not just leftover config).
    // Skipped when the database lives on the Windows side: a path under
    // /mnt/c/ or one named by CURSOR_STATE_DB belongs to a Cursor this process
    // cannot probe — the Windows install sits on the other side of the mount,
    // so `which cursor` and cursor.desktop say nothing about it.
    const windowsSideDb =
      dbPath === process.env[CURSOR_STATE_DB_ENV]?.trim() ||
      dbPath.startsWith("/mnt/c/");
    if (platform === "linux" && !windowsSideDb) {
      let cursorInstalled = false;
      try {
        await execFileAsync("which", ["cursor"], { timeout: 5000 });
        cursorInstalled = true;
      } catch {
        try {
          const desktopFile = join(homedir(), ".local/share/applications/cursor.desktop");
          await access(desktopFile, constants.R_OK);
          cursorInstalled = true;
        } catch { /* not found */ }
      }
      if (!cursorInstalled) {
        return NextResponse.json({
          found: false,
          error: "Cursor config files found but Cursor IDE does not appear to be installed. Skipping auto-import.",
        });
      }
    }

    // Strategy 1: better-sqlite3 (bundled — no external tools required)
    try {
      const tokens = extractTokensViaBetterSqlite(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch {
      // Native bindings unavailable — try CLI fallback
    }

    // Strategy 2: sqlite3 CLI
    try {
      const tokens = await extractTokensViaCLI(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch {
      // sqlite3 CLI not available either
    }

    // Strategy 3: ask user to paste manually
    return NextResponse.json({ found: false, windowsManual: true, dbPath });
  } catch ($1: unknown) { console.error("Cursor auto-import error:", $1);
    return NextResponse.json(
      { found: false, error: ($1 as Error).message },
      { status: 500 },
    );
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
