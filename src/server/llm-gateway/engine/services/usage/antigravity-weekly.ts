/**
 * Antigravity weekly quota — best-effort retrieval from retrieveUserQuotaSummary.
 * Failure never breaks the existing per-model quota display.
 * Ported from decolua/9router open-sse/services/usage/antigravity-weekly.js.
 */

import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../../providers/shared";
import { U, parseResetTime, fetchWithTimeout } from "./shared";

export interface WeeklyQuota {
  used: number;
  total: number;
  resetAt: string | null;
  remainingPercentage: number;
  unlimited: boolean;
  displayName: string;
}

const WEEKLY_CACHE_TTL_MS = 180_000; // 3 minutes
const weeklyCache = new Map<string, { promise: Promise<Record<string, WeeklyQuota>> } | { result: Record<string, WeeklyQuota>; expiresAt: number }>();

/** Exported for tests only. */
export function _clearWeeklyCache(): void {
  weeklyCache.clear();
}

const GROUP_CONFIGS = [
  {
    pattern: /gemini/i,
    weekly: { key: "gemini_weekly", displayName: "Gemini (Weekly)" },
    session: { key: "gemini_session", displayName: "Gemini (5h)" },
  },
  {
    pattern: /claude|gpt/i,
    weekly: { key: "claude_gpt_weekly", displayName: "Claude & GPT (Weekly)" },
    session: { key: "claude_gpt_session", displayName: "Claude & GPT (5h)" },
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** A retrieveUserQuotaSummary response as normalized weekly/5h quotas. Pure. */
export function parseWeeklyQuotaSummary(data: unknown): Record<string, WeeklyQuota> {
  const root = asRecord(data);
  const groups = Array.isArray(root.groups)
    ? root.groups
    : Array.isArray(asRecord(root.quotaSummary).groups)
      ? asRecord(root.quotaSummary).groups as unknown[]
      : null;
  if (!groups) return {};

  const result: Record<string, WeeklyQuota> = {};
  for (const rawGroup of groups) {
    const group = asRecord(rawGroup);
    const displayName = String(group.displayName || "");
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const rawBucket of buckets) {
      const bucket = asRecord(rawBucket);
      const windowType = String(bucket.window || "").toLowerCase();
      const bucketText = `${bucket.bucketId || ""} ${bucket.displayName || ""}`.toLowerCase();
      const isWeekly = windowType === "weekly" || bucketText.includes("weekly");
      const isSession = windowType === "5h" || bucketText.includes("five hour") || bucketText.includes("5h")
        || bucketText.includes("daily") || windowType === "daily";
      if (!isWeekly && !isSession) continue;

      // A 5h bucket upstream marks disabled (weekly was hit) stays, at 0%, so
      // the UI keeps the row; a disabled weekly bucket is truly gone.
      if (bucket.disabled === true && isWeekly) continue;

      const remainingFraction = bucket.disabled === true ? 0 : Number(bucket.remainingFraction);
      if (!Number.isFinite(remainingFraction)) continue;

      for (const config of GROUP_CONFIGS) {
        if (!config.pattern.test(displayName)) continue;
        const target = isWeekly ? config.weekly : config.session;
        if (result[target.key]) break; // first matching bucket per type wins

        const total = 1000;
        const used = Math.max(0, total - Math.round(total * remainingFraction));
        result[target.key] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
          displayName: target.displayName,
        };
        break;
      }
    }
  }
  return result;
}

/** Fetch the weekly quota summary — cached, deduped, never throws. */
export async function fetchAntigravityWeeklyQuota(
  accessToken: string,
  projectId: string | null | undefined,
  proxyOptions: unknown = null,
): Promise<Record<string, WeeklyQuota>> {
  const key = `${accessToken}::${projectId || ""}`;
  const hit = weeklyCache.get(key);
  if (hit && "promise" in hit) return hit.promise;
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  const promise = (async (): Promise<Record<string, WeeklyQuota>> => {
    try {
      const url = U("antigravity").quotaSummaryApiUrl as string | undefined;
      if (!url) return {};
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
        },
        body: JSON.stringify({ ...(projectId ? { project: projectId } : {}) }),
      }, 10000, proxyOptions) as Response;
      if (!response.ok) return {};
      return parseWeeklyQuotaSummary(await response.json());
    } catch {
      return {};
    }
  })();

  weeklyCache.set(key, { promise });
  const result = await promise;
  if (Object.keys(result).length > 0) {
    weeklyCache.set(key, { result, expiresAt: Date.now() + WEEKLY_CACHE_TTL_MS });
  } else {
    weeklyCache.delete(key);
  }
  return result;
}
