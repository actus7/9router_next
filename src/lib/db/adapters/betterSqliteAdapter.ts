import Database from "better-sqlite3";
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
  raw: Database;
}

// Periodic checkpoint to keep WAL file small (avoid huge -wal/-shm growth)
const CHECKPOINT_INTERVAL_MS: number = 60 * 1000;

export function createBetterSqliteAdapter(filePath: string): DbAdapter {
  const db: Database.Database = new Database(filePath);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  const stmtCache: Map<string, Database.Statement> = new Map();

  function prepare(sql: string): Database.Statement {
    let stmt: Database.Statement | undefined = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Truncate WAL periodically so file stays small for backup/copy
  const checkpointTimer: ReturnType<typeof setInterval> = setInterval(() => {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose(): void {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }

  // Ensure WAL is flushed and -wal/-shm files removed on shutdown
  const onShutdown: () => void = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "better-sqlite3",
    run(sql: string, params: unknown[] = []) { return prepare(sql).run(...params) as { changes: number; lastInsertRowid: number | null }; },
    get(sql: string, params: unknown[] = []) { return prepare(sql).get(...params) as Record<string, unknown> | undefined; },
    all(sql: string, params: unknown[] = []) { return prepare(sql).all(...params) as Array<Record<string, unknown>>; },
    exec(sql: string) { return db.exec(sql); },
    transaction(fn: () => void) { return db.transaction(fn)(); },
    checkpoint() { try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
