import type { DbAdapter } from "../driver";
import { currentTenantId } from "../tenant";

/**
 * Small per-tenant scalars: revision counters, lifetime totals, feature flags.
 *
 * These used to live in `_meta`, which is one row per key for the whole
 * instance. That was correct when the instance had one operator; with accounts
 * it would have every tenant sharing one revision counter and one lifetime
 * request total. They live in `kv` under a reserved scope instead, so they are
 * owned like every other row.
 *
 * `_meta` still exists and is still instance-wide — it holds what genuinely
 * belongs to the deployment, such as the app version that last booted.
 */
const SCOPE: string = "meta";

export async function getTenantMeta(db: DbAdapter, key: string): Promise<string | null> {
  const row = (await db.get(
    `SELECT value FROM kv WHERE userId = ? AND scope = ? AND key = ?`,
    [currentTenantId(), SCOPE, key],
  )) as { value: string } | undefined;
  return row ? row.value : null;
}

export async function setTenantMeta(db: DbAdapter, key: string, value: unknown): Promise<void> {
  await db.run(
    `INSERT INTO kv(userId, scope, key, value) VALUES(?, ?, ?, ?)
     ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`,
    [currentTenantId(), SCOPE, key, String(value)],
  );
}

/** Increments a counter and returns the new value. Call inside a transaction. */
export async function bumpTenantMeta(db: DbAdapter, key: string): Promise<number> {
  const next: number = (Number(await getTenantMeta(db, key)) || 0) + 1;
  await setTenantMeta(db, key, next);
  return next;
}
