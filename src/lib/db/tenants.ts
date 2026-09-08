import { getAdapter } from "./driver";
import { withTenant } from "./tenant";

/**
 * Running the same background work once per account.
 *
 * Background jobs are the third kind of caller, and the awkward one: a token
 * refresh or a quota ping belongs to no request, so there is no session and no
 * API key to say whose data it is. Under one operator they simply read the
 * whole table. Now "the whole table" spans every account, and a job that ran
 * unscoped would either throw on `currentTenantId()` or, worse, act on one
 * account's provider credentials while attributing the result to another.
 *
 * So the loop is explicit: enumerate the accounts, then do the work once
 * inside each one's context.
 */

/**
 * Every account that owns data in this database.
 *
 * Read from Neon Auth's own `user` table, which lives in the `neon_auth`
 * schema of this same database — so there is no second source of truth to
 * drift, and an account deleted there disappears from the loop on the next
 * tick. Accounts that have never written anything are included and cost one
 * no-op pass.
 */
export async function listTenantIds(): Promise<string[]> {
  const db = await getAdapter();
  const rows = await db.all(`SELECT id FROM neon_auth."user" ORDER BY id`);
  return rows.map((row) => String(row.id));
}

/**
 * Runs `work` once per account, in that account's context.
 *
 * One account's failure must not stop the rest: a provider that rejects a
 * refresh for tenant A is not a reason for tenant B's tokens to expire. The
 * error is reported through `onError` and the loop continues.
 */
export async function forEachTenant(
  work: (userId: string) => Promise<void>,
  onError?: (userId: string, error: unknown) => void,
): Promise<void> {
  for (const userId of await listTenantIds()) {
    try {
      await withTenant(userId, () => work(userId));
    } catch (error: unknown) {
      if (onError) onError(userId, error);
      else console.warn(`[DB] background work failed for tenant ${userId}:`, error);
    }
  }
}
