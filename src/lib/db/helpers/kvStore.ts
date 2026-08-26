import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "./jsonCol";

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
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [scope, key]) as { value: string } | undefined;
      return row ? parseJson<T>(row.value, fallback) : fallback;
    },
    async getAll(): Promise<Record<string, unknown>> {
      const db = await getAdapter();
      const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]) as unknown as Array<{ key: string; value: string }>;
      const out: Record<string, unknown> = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key: string, value: unknown): Promise<void> {
      const db = await getAdapter();
      db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, key, stringifyJson(value)]);
    },
    async setMany(obj: Record<string, unknown>): Promise<void> {
      const db = await getAdapter();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) {
          db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, k, stringifyJson(v)]);
        }
      });
    },
    async remove(key: string): Promise<void> {
      const db = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
    },
    async clear(): Promise<void> {
      const db = await getAdapter();
      db.run(`DELETE FROM kv WHERE scope = ?`, [scope]);
    },
  };
}
