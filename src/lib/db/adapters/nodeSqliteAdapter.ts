// Built-in node:sqlite adapter — available in Node >= 22.5.0.
// No native build, no npm install. API mirrors betterSqliteAdapter.
import { PRAGMA_SQL } from "../schema";

interface DbAdapter {
  driver: string;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | null };
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  exec(sql: string): void;
  transaction(fn: () => void): void;
  checkpoint(): void;
  close(): void;
  raw: unknown;
}

const CHECKPOINT_INTERVAL_MS: number = 60 * 1000;

export async function createNodeSqliteAdapter(filePath: string): Promise<DbAdapter> {
  // Suppress "ExperimentalWarning: SQLite is an experimental feature" from node:sqlite.
  // Stable enough for production use as of Node 22.x (RC quality).
  const origEmit = process.emit;
  (process as any).emit = function (name: string | symbol, data: any, ...rest: unknown[]): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (name === "warning" && data?.name === "ExperimentalWarning" && /SQLite/i.test(data.message || "")) {
      return false;
    }
    return (origEmit as unknown as (event: string | symbol, ...args: unknown[]) => boolean).call(process, name, data, ...rest);
  };

  // Dynamic import — fails on Node < 22.5 → driver.js falls back to sql.js
  const sqlite = await import("node:sqlite");
  const Database = sqlite.DatabaseSync;
  const db = new Database(filePath);

  db.exec(PRAGMA_SQL);

  const stmtCache: Map<string, any> = new Map();
  function prepare(sql: string): any {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Periodic WAL checkpoint to keep -wal/-shm small
  const checkpointTimer: ReturnType<typeof setInterval> = setInterval(() => {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose(): void {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }
  const onShutdown: () => void = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "node:sqlite",
    run(sql: string, params: unknown[] = []) {
      const r = prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql: string, params: unknown[] = []) {
      return prepare(sql).get(...params) as Record<string, unknown> | undefined;
    },
    all(sql: string, params: unknown[] = []) {
      return prepare(sql).all(...params) as Array<Record<string, unknown>>;
    },
    exec(sql: string) { return db.exec(sql); },
    transaction(fn: () => void) {
      // node:sqlite has no transaction wrapper. Use SAVEPOINT for nested support.
      const sp: string = `sp_${Math.random().toString(36).slice(2)}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        const r = fn();
        db.exec(`RELEASE ${sp}`);
        return r;
      } catch (e: unknown) {
        try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
        throw e;
      }
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
