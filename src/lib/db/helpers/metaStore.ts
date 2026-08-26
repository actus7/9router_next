import { getAdapter } from "../driver";

interface DbAdapter {
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | null };
}

export async function getMeta(key: string, fallback: string | null = null): Promise<string | null> {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [key]) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getAdapter();
  db.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}

// Sync versions for use during migration (adapter passed directly)
export function getMetaSync(adapter: DbAdapter, key: string, fallback: string | null = null): string | null {
  const row = adapter.get(`SELECT value FROM _meta WHERE key = ?`, [key]) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setMetaSync(adapter: DbAdapter, key: string, value: unknown): void {
  adapter.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
}
