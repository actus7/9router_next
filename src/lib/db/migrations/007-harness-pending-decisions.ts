interface DbAdapter {
  exec(sql: string): void;
  all(sql: string): Array<Record<string, unknown>>;
}

function addColumnIfMissing(
  db: DbAdapter,
  columns: Set<string>,
  name: string,
  definition: string,
): void {
  if (!columns.has(name)) {
    db.exec(`ALTER TABLE harnessPendingWrites ADD COLUMN ${name} ${definition}`);
  }
}

export default {
  version: 7,
  name: "harness-pending-decisions",
  up(db: DbAdapter): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS harnessPendingWrites (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewedAt TEXT,
        result TEXT,
        createdAt TEXT NOT NULL
      );
    `);
    const columns = new Set(
      db.all("PRAGMA table_info(harnessPendingWrites)").map((row) => String(row.name)),
    );
    addColumnIfMissing(db, columns, "status", "TEXT NOT NULL DEFAULT 'pending'");
    addColumnIfMissing(db, columns, "reviewedAt", "TEXT");
    addColumnIfMissing(db, columns, "result", "TEXT");
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_hpw_status_created ON harnessPendingWrites(status, createdAt)",
    );
  },
};
