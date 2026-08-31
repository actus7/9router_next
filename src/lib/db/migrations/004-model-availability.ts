import { TABLES, buildCreateTableSql } from "../schema";

interface DbAdapter {
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number };
  exec(sql: string): void;
}

const MODEL_LOCK_PREFIX = "modelLock_";

/** Moves legacy per-model locks out of providerConnections.data without touching credentials. */
export default {
  version: 4,
  name: "model-availability",
  up(db: DbAdapter): void {
    const table = TABLES.modelAvailability;
    db.exec(buildCreateTableSql("modelAvailability", table));
    for (const index of table.indexes || []) db.exec(index);

    const now = new Date().toISOString();
    for (const row of db.all("SELECT id, data FROM providerConnections")) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(row.data || "{}")) as Record<string, unknown>;
      } catch {
        continue;
      }

      let changed = false;
      for (const [key, value] of Object.entries(data)) {
        if (!key.startsWith(MODEL_LOCK_PREFIX) || typeof value !== "string") continue;
        const modelId = key.slice(MODEL_LOCK_PREFIX.length) || "__all";
        const untilMs = Date.parse(value);
        if (Number.isFinite(untilMs) && untilMs > Date.now()) {
          db.run(
            `INSERT INTO modelAvailability(connectionId, modelId, status, reason, errorCode, lastError, until, createdAt, updatedAt)
             VALUES(?, ?, 'cooldown', 'legacy', ?, ?, ?, ?, ?)
             ON CONFLICT(connectionId, modelId) DO NOTHING`,
            [row.id, modelId, data.errorCode ?? null, data.lastError ?? null, value, now, now],
          );
        }
        delete data[key];
        changed = true;
      }
      if (changed) {
        db.run("UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?", [JSON.stringify(data), now, row.id]);
      }
    }
  },
};
