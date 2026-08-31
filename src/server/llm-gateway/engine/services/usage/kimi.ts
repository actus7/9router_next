/**
 * Kimi Coding usage — GET /v1/usages
 *
 * Dual auth (single provider id `kimi`):
 *   - apiKey present → x-api-key only (platform / coding API key)
 *   - else accessToken → Bearer + X-Msh-* (device-code OAuth)
 *
 * Note: chat messages use combined x-api-key; /usages OAuth is Bearer.
 * 403 permission_denied is NOT auth-expired — account lacks usage feature / sub.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch";
import { parseResetTime, toFiniteNumber } from "./shared";
import { buildKimiHeaders } from "../../config/appConstants";

const USAGE_URL = "https://api.kimi.com/coding/v1/usages";

const PLAN_LEVELS: Record<string, string> = {
  LEVEL_BASIC: "Moderato",
  LEVEL_INTERMEDIATE: "Allegretto",
  LEVEL_ADVANCED: "Allegro",
  LEVEL_STANDARD: "Vivace",
};

function getKimiPlanName(level: unknown): string {
  if (!level) return "";
  const key = String(level);
  if (PLAN_LEVELS[key]) return PLAN_LEVELS[key];
  return key.replace(/^LEVEL_/, "").toLowerCase();
}

/** Best-effort extract human message from Kimi error JSON (403 body is Connect-RPC-ish). */
function formatKimiUsageError(status: number, responseText: string): string {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(responseText || "");
  } catch {
    /* plain text */
  }

  const detail0 = Array.isArray(parsed?.details) ? parsed.details[0] as Record<string, unknown> : null;
  const debug = (detail0?.debug || parsed?.debug) as Record<string, unknown> | null;
  const reason = (debug?.reason || parsed?.reason || "") as string;
  const localized =
    ((debug?.localizedMessage as Record<string, unknown>)?.message as string) ||
    ((detail0?.localizedMessage as Record<string, unknown>)?.message as string) ||
    (parsed?.message as string) ||
    "";

  if (status === 401) {
    return "Kimi authentication expired. Please re-authorize.";
  }

  // Live OAuth token without Kimi Code usage entitlement returns 403
  // REASON_FEATURE_NO_PERMISSION — not an expired session.
  if (
    status === 403 &&
    (reason === "REASON_FEATURE_NO_PERMISSION" ||
      /permission_denied|do not have permission|subscribe/i.test(
        `${parsed?.code || ""} ${localized} ${responseText || ""}`,
      ))
  ) {
    return (
      localized ||
      "Kimi connected, but this account has no permission to view usage. Subscribe to Kimi Code to access quota."
    );
  }

  const snippet = (localized || responseText || "").slice(0, 100);
  return snippet
    ? `Kimi Coding connected. API Error ${status}: ${snippet}`
    : `Kimi Coding connected. API Error ${status}`;
}

interface QuotaEntry {
  used: number;
  total: number;
  remainingPercentage: number;
  resetAt: string | null;
  unlimited: boolean;
}

function makeQuota({ used, total, remaining, resetAt }: { used: number; total: number; remaining: number | null; resetAt: string | null }): QuotaEntry {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  // Prefer provider remaining when present; never set absolute `remaining`
  // on the quota object — QuotaTable treats it as a 0–100 percentage.
  let remainingPct: number;
  if (safeTotal > 0 && remaining != null && Number.isFinite(Number(remaining))) {
    remainingPct = (Math.max(0, Number(remaining)) / safeTotal) * 100;
  } else if (safeTotal > 0) {
    remainingPct = (Math.max(0, safeTotal - safeUsed) / safeTotal) * 100;
  } else {
    remainingPct = 0;
  }
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage: remainingPct,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

/**
 * @param {string|null|undefined} accessToken
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 * @param {object|null} providerSpecificData
 */
export async function getKimiUsage(
  accessToken: string | null = null,
  apiKey: string | null = null,
  proxyOptions: unknown = null,
  providerSpecificData: Record<string, unknown> | null = null,
) {
  const useApiKey = typeof apiKey === "string" && apiKey.length > 0;
  const useOAuth = !useApiKey && typeof accessToken === "string" && accessToken.length > 0;

  if (!useApiKey && !useOAuth) {
    return { message: "Kimi access token or API key not available." };
  }

  const authHeaders: Record<string, string> = useApiKey
    ? { "x-api-key": apiKey! }
    : {
        Authorization: `Bearer ${accessToken}`,
        ...buildKimiHeaders(providerSpecificData?.deviceId as string),
      };

  try {
    const response = await proxyAwareFetch(
      USAGE_URL,
      {
        method: "GET",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
      proxyOptions as null,
    ) as Response;

    const responseText = await response.text().catch(() => "");

    if (!response.ok) {
      return {
        plan: "Kimi Coding",
        message: formatKimiUsageError(response.status, responseText),
      };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(responseText || "{}");
    } catch {
      return {
        plan: "Kimi Coding",
        message: "Kimi Coding connected. Invalid JSON response from API.",
      };
    }

    const quotas: Record<string, QuotaEntry> = {};
    const usageObj = data?.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : {};
    const usageLimit = toFiniteNumber(usageObj.limit ?? usageObj.Limit, 0);
    const usageUsed = toFiniteNumber(usageObj.used ?? usageObj.Used, 0);
    const usageRemainingRaw = usageObj.remaining ?? usageObj.Remaining;
    const usageRemaining =
      usageRemainingRaw != null && usageRemainingRaw !== ""
        ? toFiniteNumber(usageRemainingRaw, NaN)
        : NaN;
    const usageResetTime =
      usageObj.resetTime || usageObj.ResetTime || usageObj.reset_at || usageObj.resetAt;

    if (usageLimit > 0) {
      quotas.Weekly = makeQuota({
        used: usageUsed,
        total: usageLimit,
        remaining: Number.isFinite(usageRemaining) ? usageRemaining : null,
        resetAt: parseResetTime(usageResetTime),
      });
    }

    const limitsArray = Array.isArray(data?.limits) ? data.limits as Record<string, unknown>[] : [];
    for (const item of limitsArray) {
      if (!item || typeof item !== "object") continue;
      const detail = item.detail && typeof item.detail === "object" ? item.detail as Record<string, unknown> : {};
      const limit = toFiniteNumber(detail.limit ?? detail.Limit, 0);
      const remaining = toFiniteNumber(detail.remaining ?? detail.Remaining, NaN);
      const resetTime = detail.resetTime || detail.reset_at || detail.resetAt;
      if (limit > 0) {
        const rem = Number.isFinite(remaining) ? remaining : Math.max(0, limit);
        quotas.Ratelimit = makeQuota({
          used: Math.max(0, limit - rem),
          total: limit,
          remaining: rem,
          resetAt: parseResetTime(resetTime),
        });
      }
    }

    const membershipLevel = (data?.user as Record<string, unknown>)?.membership ? ((data.user as Record<string, unknown>).membership as Record<string, unknown>).level : undefined;
    const planName = getKimiPlanName(membershipLevel) || "Kimi Coding";

    if (Object.keys(quotas).length > 0) {
      return { plan: planName, quotas };
    }

    return {
      plan: planName,
      message: "Kimi Coding connected. Usage tracked per request.",
    };
  } catch (error: unknown) {
    return {
      message: `Kimi Coding connected. Unable to fetch usage: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
