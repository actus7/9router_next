import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";

/** Whose spend a budget counts: the organization, one member, or one key. */
export interface SpendScope {
  type: "org" | "member" | "key";
  id: string;
}

/** The first instant of the current UTC month, as usageHistory writes timestamps. */
export function currentMonthStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * What a subject spent this calendar month (UTC), as priced in usage. Served by
 * idx_uh_actor_ts / idx_uh_key_ts; the org total by idx_uh_ts.
 */
export async function monthSpendUsd(scope: SpendScope): Promise<number> {
  const db = await getAdapter();
  const filter = scope.type === "member" ? "AND actorUserId = ?" : scope.type === "key" ? "AND apiKey = ?" : "";
  const params: unknown[] = [currentTenantId(), currentMonthStart()];
  if (scope.type !== "org") params.push(scope.id);
  const row = await db.get(
    `SELECT COALESCE(SUM(cost), 0) AS spent FROM usageHistory WHERE userId = ? AND timestamp >= ? ${filter}`,
    params,
  ) as { spent?: number | string } | undefined;
  return Number(row?.spent ?? 0);
}

