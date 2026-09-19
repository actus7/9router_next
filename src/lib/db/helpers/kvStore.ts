import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "./jsonCol";
import { chunked, valuesRows } from "./batch";

interface KvStore {
  get<T = unknown>(key: string, fallback?: T | null): Promise<T | null>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  setMany(obj: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function makeKv(scope: string): KvStore {
  return {
    async get<T = unknown>(key: string, fallback: T | null = null): Promise<T | null> {
      const db = await getAdapter();
      const row = (await db.get(`SELECT value FROM kv WHERE userId = ? AND scope = ? AND key = ?`, [currentTenantId(), scope, key])) as { value: string } | undefined;
      return row ? parseJson<T>(row.value, fallback) : fallback;
    },
    async getAll(): Promise<Record<string, unknown>> {
      const db = await getAdapter();
      const rows = (await db.all(`SELECT key, value FROM kv WHERE userId = ? AND scope = ?`, [currentTenantId(), scope])) as unknown as Array<{ key: string; value: string }>;
      const out: Record<string, unknown> = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key: string, value: unknown): Promise<void> {
      const db = await getAdapter();
      await db.run(`INSERT INTO kv(userId, scope, key, value) VALUES(?, ?, ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`, [currentTenantId(), scope, key, stringifyJson(value)]);
    },
    async setMany(obj: Record<string, unknown>): Promise<void> {
      const entries = Object.entries(obj);
      if (entries.length === 0) return;
      const db = await getAdapter();
      const userId = currentTenantId();
      // One statement per batch: the name says "many", and a loop of single
      // inserts made it one Neon round-trip per key.
      await db.transaction(async () => {
        for (const batch of chunked(entries)) {
          await db.run(
            `INSERT INTO kv(userId, scope, key, value) VALUES ${valuesRows(batch.length, "(?, ?, ?, ?)")} ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`,
            batch.flatMap(([k, v]) => [userId, scope, k, stringifyJson(v)]),
          );
        }
      });
    },
    async remove(key: string): Promise<void> {
      const db = await getAdapter();
      await db.run(`DELETE FROM kv WHERE userId = ? AND scope = ? AND key = ?`, [currentTenantId(), scope, key]);
    },
    async clear(): Promise<void> {
      const db = await getAdapter();
      await db.run(`DELETE FROM kv WHERE userId = ? AND scope = ?`, [currentTenantId(), scope]);
    },
  };
}
