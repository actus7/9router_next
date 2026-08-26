import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

const SCOPE: string = "disabledModels";

export async function getDisabledModels(): Promise<Record<string, string[]>> {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]) as unknown as Array<{ key: string; value: string }>;
  const out: Record<string, string[]> = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []) as string[];
  return out;
}

export async function getDisabledByProvider(providerAlias: string): Promise<string[]> {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]) as { value: string } | undefined;
  return row ? ((parseJson(row.value, []) as string[]) || []) : [];
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
export async function disableModels(providerAlias: string, ids: string[]): Promise<void> {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]) as { value: string } | undefined;
    const current: string[] = row ? ((parseJson(row.value, []) as string[]) || []) : [];
    const merged: string[] = [...new Set([...current, ...ids])];
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, providerAlias, stringifyJson(merged)]
    );
  });
}

export async function enableModels(providerAlias: string, ids?: string[]): Promise<void> {
  if (!providerAlias) return;
  const db = await getAdapter();
  db.transaction(() => {
    if (!Array.isArray(ids) || ids.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]) as { value: string } | undefined;
    const current: string[] = row ? ((parseJson(row.value, []) as string[]) || []) : [];
    const removeSet: Set<string> = new Set(ids);
    const next: string[] = current.filter((id: string) => !removeSet.has(id));
    if (next.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, providerAlias, stringifyJson(next)]
      );
    }
  });
}
