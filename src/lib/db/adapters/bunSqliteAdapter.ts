// Bun runtime adapter — uses built-in bun:sqlite (native, fastest under Bun).
// Loaded only when process.versions.bun is present.
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

export async function createBunSqliteAdapter(filePath: string): Promise<DbAdapter> {
  // Dynamic import — only resolves under Bun runtime
  const { Database } = await import("bun:sqlite") as { Database: new (path: string, opts?: Record<string, unknown>) => unknown };
  const db = new Database(filePath, { create: true }) as any;
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
    driver: "bun:sqlite",
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
      // bun:sqlite has db.transaction() API (similar to better-sqlite3)
      const tx = db.transaction(fn);
      return tx();
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
