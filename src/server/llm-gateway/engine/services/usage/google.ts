/**
 * Google usage handlers (Gemini CLI + Antigravity)
 */

import { CLIENT_METADATA } from "../../config/appConstants";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT } from "../../providers/shared";
import { U, parseResetTime, normalizeCloudCodeProjectId, fetchWithTimeout } from "./shared";
import { fetchAntigravityWeeklyQuota, type WeeklyQuota } from "./antigravity-weekly";

// Antigravity API config (from Quotio) — urls from registry, oauth client + dynamic UA kept here
const ANTIGRAVITY_CONFIG = {
  ...U("antigravity"),
  ...ANTIGRAVITY_OAUTH_CLIENT,
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
} as Record<string, unknown>;

/**
 * Gemini CLI Usage — fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */
export async function getGeminiUsage(accessToken: string, providerSpecificData: Record<string, unknown>, proxyOptions: unknown = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup.
    // #1271: OAuth save stores projectId on the connection, not providerSpecificData.
    let projectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId((subInfo as Record<string, unknown>)?.cloudaicompanionProject);
      plan = ((subInfo as Record<string, unknown>)?.currentTier as Record<string, unknown>)?.name as string || plan;
    }

    if (!projectId) {
      return {
        plan,
        message: "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const response = await fetchWithTimeout(
      (U("gemini-cli") as Record<string, unknown>).quotaUrl as string,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
      },
      10000,
      proxyOptions
    ) as Response;

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas: Record<string, unknown> = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error: unknown) {
    return { message: `Gemini CLI error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken: string, proxyOptions: unknown = null): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchWithTimeout(
      (U("gemini-cli") as Record<string, unknown>).loadCodeAssistUrl as string,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metadata: CLIENT_METADATA }),
      },
      10000,
      proxyOptions
    ) as Response;
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */
export async function getAntigravityUsage(accessToken: string, providerSpecificData: Record<string, unknown>, proxyOptions: unknown = null) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
    const projectId = (subscriptionInfo as Record<string, unknown>)?.cloudaicompanionProject || null;

    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.quotaApiUrl as string, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent as string,
        "Content-Type": "application/json",
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
      body: JSON.stringify({
        ...(projectId ? { project: projectId } : {})
      }),
    }, 10000, proxyOptions) as Response;

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {}
      };
    }

    if (response.status === 401) {
      return {
        message: "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {}
      };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas: Record<string, unknown> = {};

    // Free-tier accounts only have weekly quotas (no separate 5h window), and
    // fetchAvailableModels reports misleading per-model quota for them (a
    // missing remainingFraction reads as 0%). Per-model rows are paid-tier only.
    const paidTierId = ((subscriptionInfo as Record<string, unknown>)?.paidTier as Record<string, unknown> | undefined)?.id;
    const isFreeTier = !paidTierId || paidTierId === "free-tier";

    // Parse model quotas (inspired by vscode-antigravity-cockpit)
    if (!isFreeTier && data.models) {
      // Filter only recommended/important models (must match PROVIDER_MODELS ag ids)
      const importantModels = [
        'gemini-3.7-flash-high',
        'gemini-3.7-flash-medium',
        'gemini-3.7-flash-low',
        'gemini-3.6-flash-high',
        'gemini-3.6-flash-medium',
        'gemini-3.6-flash-low',
        'gemini-3.5-flash-low',
        'gemini-3.5-flash-extra-low',
        'gemini-pro-agent',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
        // Image generation models
        'gemini-3.1-flash-image',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        const infoObj = info as Record<string, unknown>;
        // Skip models without quota info
        if (!infoObj.quotaInfo) {
          continue;
        }

        // Skip internal models and non-important models
        if (infoObj.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const quotaInfo = infoObj.quotaInfo as Record<string, unknown>;
        const remainingFraction = (quotaInfo.remainingFraction as number) || 0;
        const remainingPercentage = remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: infoObj.displayName || modelKey,
        };
      }
    }

    // Best-effort weekly/5h overlay — never blocks or breaks the per-model rows.
    try {
      const weeklyQuotas = await fetchAntigravityWeeklyQuota(accessToken, projectId as string | null, proxyOptions);
      reconcileSessionQuota(weeklyQuotas.gemini_session, Object.entries(quotas).filter(([k]) => k.startsWith("gemini-") && !k.includes("image")));
      reconcileSessionQuota(weeklyQuotas.claude_gpt_session, Object.entries(quotas).filter(([k]) => k.startsWith("claude-")));
      Object.assign(quotas, weeklyQuotas);
    } catch {
      // weekly is best-effort
    }

    return {
      plan: ((subscriptionInfo as Record<string, unknown>)?.currentTier as Record<string, unknown>)?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error: unknown) {
    console.error("[Antigravity Usage] Error:", error instanceof Error ? error.message : String(error), error instanceof Error ? error.cause : undefined);
    return { message: `Antigravity error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * When every model of a family is exhausted until a future reset, the 5h
 * session row must say so too (it is the row the user watches), and borrow the
 * latest reset time.
 */
function reconcileSessionQuota(session: WeeklyQuota | undefined, models: Array<[string, unknown]>): void {
  if (!session || models.length === 0) return;
  const quotas = models.map(([, quota]) => quota as { remainingPercentage?: number; resetAt?: string | null });
  if (!quotas.every((quota) => (quota.remainingPercentage ?? 0) === 0)) return;
  if (!(session.remainingPercentage > 0)) return;
  const latestReset = quotas.reduce<string | null>((max, quota) => (
    !max || (quota.resetAt && new Date(quota.resetAt) > new Date(max)) ? (quota.resetAt ?? null) : max
  ), null);
  session.used = session.total;
  session.remainingPercentage = 0;
  if (latestReset) session.resetAt = latestReset;
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken: string, proxyOptions: unknown = null): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.loadProjectApiUrl as string, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
    }, 10000, proxyOptions) as Response;

    if (!response.ok) return null;
    return await response.json();
  } catch (error: unknown) {
    console.error("[Antigravity Subscription] Error:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
