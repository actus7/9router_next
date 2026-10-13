import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";

export interface MemberModelUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  rawModel: string;
  provider: string;
  memberId: string;
  memberName: string;
  lastUsed: string;
}

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "60d": 60 };

/** The first timestamp a period covers, as the other usage views read it; null for "all". */
export function periodCutoff(period: string, now: Date = new Date()): string | null {
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = PERIOD_DAYS[period];
  return days ? new Date(now.getTime() - days * DAY_MS).toISOString() : null;
}

/**
 * Usage per member and model over a period. Read from usageHistory rather than
 * the daily aggregate so every period answers the same way; rows from before
 * members were recorded belong to the tenant's owner, whose id is the tenant's.
 */
export async function usageByMember(period: string): Promise<Record<string, MemberModelUsage>> {
  const db = await getAdapter();
  const tenantId = currentTenantId();
  const cutoff = periodCutoff(period);
  const rows = await db.all(
    `SELECT COALESCE(actorUserId, userId) AS member, model, provider,
            COUNT(*) AS requests, SUM(promptTokens) AS prompttokens,
            SUM(completionTokens) AS completiontokens, SUM(cost) AS spent, MAX(timestamp) AS lastused
     FROM usageHistory
     WHERE userId = ? ${cutoff ? "AND timestamp >= ?" : ""}
     GROUP BY 1, 2, 3`,
    cutoff ? [tenantId, cutoff] : [tenantId],
  ) as Array<Record<string, unknown>>;
  const names = await memberNames([...new Set(rows.map((row) => String(row.member)))]);
  const usage: Record<string, MemberModelUsage> = {};
  for (const row of rows) {
    const memberId = String(row.member);
    const model = String(row.model ?? "");
    const provider = String(row.provider ?? "");
    usage[`${memberId}|${model}|${provider}`] = {
      requests: Number(row.requests ?? 0),
      promptTokens: Number(row.prompttokens ?? 0),
      completionTokens: Number(row.completiontokens ?? 0),
      cachedTokens: 0,
      cost: Number(row.spent ?? 0),
      rawModel: model,
      provider,
      memberId,
      memberName: names.get(memberId) ?? memberId.slice(0, 8),
      lastUsed: String(row.lastused ?? ""),
    };
  }
  return usage;
}

/** Display names from Neon Auth — only for ids that appear in this tenant's usage. */
async function memberNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const db = await getAdapter();
  const rows = await db.all(
    `SELECT id, name, email FROM neon_auth."user" WHERE id::text IN (${ids.map(() => "?").join(", ")})`,
    ids,
  ) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "";
    const email = typeof row.email === "string" ? row.email : "";
    names.set(String(row.id), name && email ? `${name} (${email})` : name || email);
  }
  return names;
}
