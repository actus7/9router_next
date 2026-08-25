import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema";

interface DbAdapter {
  driver: string;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | null };
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  exec(sql: string): void;
  transaction(fn: () => void): void;
  close(): void;
  raw: initSqlJs.Database;
}

let SQL: typeof initSqlJs | null = null;

async function loadSql(): Promise<typeof initSqlJs> {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

export async function createSqlJsAdapter(filePath: string): Promise<DbAdapter> {
  const SQLLib: typeof initSqlJs = await loadSql();
  const buf: Buffer | null = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db: initSqlJs.Database = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty: boolean = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const SAVE_DEBOUNCE_MS: number = 100;

  function persist(): void {
    const data: Uint8Array = db.export();
    fs.writeFileSync(filePath, Buffer.from(data));
    dirty = false;
  }

  function scheduleSave(): void {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) {
        try { persist(); } catch (e: unknown) { console.error("[sqljs] save failed:", e); }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params: unknown[]): unknown[] | undefined {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | null } {
    const stmt: initSqlJs.Statement = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes: number = db.getRowsModified();
      const lastInsertRowid: number | null = (db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] as number) ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function get(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
    const stmt: initSqlJs.Statement = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject() as Record<string, unknown>;
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
    const stmt: initSqlJs.Statement = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows: Array<Record<string, unknown>> = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql: string): void {
    db.exec(sql);
    scheduleSave();
  }

  function transaction(fn: () => void): void {
    const sp: string = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      scheduleSave();
      return result;
    } catch (e: unknown) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  function close(): void {
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty) persist();
    db.close();
  }

  // Flush on shutdown
  const flush: () => void = () => { if (dirty) try { persist(); } catch {} };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}
