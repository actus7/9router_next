import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { TtlMemo } from "@/lib/ttlMemo";

const SCOPE: string = "disabledModels";

// ponytail: read on every routed attempt. Keyed by tenant; writes below drop the
// entry, another instance's write is seen within the TTL.
const DISABLED_TTL_MS = 30_000;
const disabledMemo = new TtlMemo<Record<string, string[]>>(DISABLED_TTL_MS);

export async function getDisabledModels(): Promise<Record<string, string[]>> {
  const userId = currentTenantId();
  const cached = disabledMemo.get(userId);
  if (cached) return structuredClone(cached);
  const generation = disabledMemo.generation;
  const db = await getAdapter();
  const rows = await db.all(`SELECT key, value FROM kv WHERE userId = ? AND scope = ?`, [userId, SCOPE]) as unknown as Array<{ key: string; value: string }>;
  const out: Record<string, string[]> = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []) as string[];
  disabledMemo.set(userId, structuredClone(out), generation);
  return out;
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
export async function disableModels(providerAlias: string, ids: string[]): Promise<void> {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getAdapter();
  await db.transaction(async () => {
    const row = await db.get(`SELECT value FROM kv WHERE userId = ? AND scope = ? AND key = ?`, [currentTenantId(), SCOPE, providerAlias]) as { value: string } | undefined;
    const current: string[] = row ? ((parseJson(row.value, []) as string[]) || []) : [];
    const merged: string[] = [...new Set([...current, ...ids])];
    await db.run(
      `INSERT INTO kv(userId, scope, key, value) VALUES(?, ?, ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`,
      [currentTenantId(), SCOPE, providerAlias, stringifyJson(merged)]
    );
  });
  disabledMemo.delete(currentTenantId());
}

export async function enableModels(providerAlias: string, ids?: string[]): Promise<void> {
  if (!providerAlias) return;
  const db = await getAdapter();
  await db.transaction(async () => {
    if (!Array.isArray(ids) || ids.length === 0) {
      await db.run(`DELETE FROM kv WHERE userId = ? AND scope = ? AND key = ?`, [currentTenantId(), SCOPE, providerAlias]);
      return;
    }
    const row = await db.get(`SELECT value FROM kv WHERE userId = ? AND scope = ? AND key = ?`, [currentTenantId(), SCOPE, providerAlias]) as { value: string } | undefined;
    const current: string[] = row ? ((parseJson(row.value, []) as string[]) || []) : [];
    const removeSet: Set<string> = new Set(ids);
    const next: string[] = current.filter((id: string) => !removeSet.has(id));
    if (next.length === 0) {
      await db.run(`DELETE FROM kv WHERE userId = ? AND scope = ? AND key = ?`, [currentTenantId(), SCOPE, providerAlias]);
    } else {
      await db.run(
        `INSERT INTO kv(userId, scope, key, value) VALUES(?, ?, ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`,
        [currentTenantId(), SCOPE, providerAlias, stringifyJson(next)]
      );
    }
  });
  disabledMemo.delete(currentTenantId());
}
