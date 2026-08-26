import { ensureDirs, DATA_FILE } from "./paths";

interface DbAdapter {
  driver: string;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | null };
  exec(sql: string): void;
  transaction(fn: () => void): void;
  close(): void;
  raw: unknown;
}

interface DbAdapterState {
  instance: DbAdapter | null;
  initPromise: Promise<DbAdapter> | null;
  logged: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var _dbAdapter: DbAdapterState | undefined;
}

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state: DbAdapterState = global._dbAdapter!;

async function tryBunSqlite(): Promise<DbAdapter | null> {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e: any) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite(): Promise<DbAdapter | null> {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e: any) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite(): Promise<DbAdapter | null> {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min]: number[] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e: any) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs(): Promise<DbAdapter | null> {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e: any) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter(): Promise<DbAdapter> {
  ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter: DbAdapter | null = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter(): Promise<DbAdapter> {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a: DbAdapter) => { state.instance = a; return a; });
  return state.initPromise;
}

function getAdapterSync(): DbAdapter {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
