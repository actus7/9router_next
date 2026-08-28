/**
 * Codex (OpenAI) usage handler
 */

import { proxyAwareFetch as _proxyAwareFetch } from "../../utils/proxyFetch";
import { U, parseResetTime, toFiniteNumber } from "./shared";

// Typed wrapper for the untyped proxyAwareFetch
type ProxyFetchFn = (url: string, options?: RequestInit, proxyOptions?: unknown) => Promise<unknown>;
const proxyAwareFetch = _proxyAwareFetch as unknown as ProxyFetchFn;

// Codex (OpenAI) API config
const CODEX_CONFIG = {
  usageUrl: U("codex").url as string,
  resetCreditsUrl: U("codex").resetCreditsUrl as string,
  resetCreditsConsumeUrl: U("codex").resetCreditsConsumeUrl as string,
};

interface CodexRateLimit {
  primary_window?: unknown;
  primary?: unknown;
  secondary_window?: unknown;
  secondary?: unknown;
  limit_reached?: boolean;
  [key: string]: unknown;
}

interface CodexCredit {
  status?: string;
  granted_at?: string;
  grantedAt?: string;
  expires_at?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

interface CodexResetCreditsResponse {
  available_count?: number;
  availableCount?: number;
  credits?: CodexCredit[];
  [key: string]: unknown;
}

interface CodexConsumeResponse {
  code?: string;
  windows_reset?: number;
  message?: string;
  [key: string]: unknown;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === "string") {
    date = new Date(value);
  } else {
    return null;
  }
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : null;
}

function getCodexAccountId(providerSpecificData: Record<string, unknown> | null): string | null {
  return (providerSpecificData?.workspaceId as string) || (providerSpecificData?.accountId as string) || (providerSpecificData?.chatgptAccountId as string) || null;
}

function getCodexRateLimitBody(snapshot: unknown): CodexRateLimit | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const s = snapshot as Record<string, unknown>;
  return (s.rate_limit && typeof s.rate_limit === "object"
    ? s.rate_limit as CodexRateLimit
    : snapshot as CodexRateLimit);
}

function formatCodexWindow(window: unknown): Record<string, unknown> {
  const w = window as Record<string, unknown>;
  const used = Math.max(0, Math.min(100, toFiniteNumber(w?.used_percent ?? w?.percent_used, 0)));
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt: parseResetTime(w?.reset_at ?? w?.resets_at ?? w?.resetAt ?? null),
    unlimited: false,
  };
}

function appendCodexQuotaWindows(quotas: Record<string, unknown>, prefix: string, snapshot: unknown): boolean {
  const rateLimit = getCodexRateLimitBody(snapshot);
  if (!rateLimit) return false;

  const s = snapshot as Record<string, unknown>;
  const primary = rateLimit.primary_window || rateLimit.primary || s.primary_window || s.primary;
  const secondary = rateLimit.secondary_window || rateLimit.secondary || s.secondary_window || s.secondary;
  let added = false;

  if (primary) {
    quotas[prefix ? `${prefix}_session` : "session"] = formatCodexWindow(primary);
    added = true;
  }
  if (secondary) {
    quotas[prefix ? `${prefix}_weekly` : "weekly"] = formatCodexWindow(secondary);
    added = true;
  }

  return added;
}

function getCodexReviewRateLimit(data: Record<string, unknown>): unknown {
  if (data.code_review_rate_limit || data.review_rate_limit) {
    return data.code_review_rate_limit || data.review_rate_limit;
  }

  const byLimitId = data.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    const b = byLimitId as Record<string, unknown>;
    return b.code_review || b.codex_review || b.review || null;
  }

  const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
  return (additional as Record<string, unknown>[]).find((entry: Record<string, unknown>) => {
    const id = String(entry?.limit_name || entry?.metered_feature || entry?.id || "").toLowerCase();
    return id === "code_review" || id === "codex_review" || id === "review" || id.includes("review");
  }) || null;
}

export async function getCodexUsage(accessToken: string, proxyOptions: unknown = null): Promise<unknown> {
  try {
    const response = await proxyAwareFetch(CODEX_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }, proxyOptions) as { ok: boolean; status: number; json: () => Promise<Record<string, unknown>> };

    if (!response.ok) {
      return { message: `Codex connected. Usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();
    const normalRateLimit = data.rate_limit || data.rate_limits || (data.rate_limits_by_limit_id as Record<string, unknown>)?.codex || {};
    const reviewRateLimit = getCodexReviewRateLimit(data);
    const availableResetCredits = Math.max(0, toFiniteNumber((data.rate_limit_reset_credits as Record<string, unknown>)?.available_count, 0));
    const quotas: Record<string, unknown> = {};

    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);

    return {
      plan: data.plan_type || (data.summary as Record<string, unknown>)?.plan || "unknown",
      limitReached: getCodexRateLimitBody(normalRateLimit)?.limit_reached || false,
      reviewLimitReached: getCodexRateLimitBody(reviewRateLimit)?.limit_reached || false,
      resetCredits: { availableCount: availableResetCredits },
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${(error as Error).message}`);
  }
}

export async function getCodexRateLimitResetCredits(accessToken: string, proxyOptions: unknown = null, providerSpecificData: Record<string, unknown> | null = null): Promise<unknown> {
  if (!accessToken) {
    throw new Error("No Codex access token available. Please re-authorize the connection.");
  }

  const accountId = getCodexAccountId(providerSpecificData);
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Accept": "application/json",
    "OpenAI-Beta": "codex-1",
    "originator": "codex_cli_rs",
  };
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;

  const response = await proxyAwareFetch(CODEX_CONFIG.resetCreditsUrl, {
    method: "GET",
    headers,
  }, proxyOptions) as { ok: boolean; status: number; json: () => Promise<CodexResetCreditsResponse> };

  let data: CodexResetCreditsResponse | null = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = (data?.message as string) || (data?.error as string) || (data?.detail as string) || `Codex reset credits API unavailable (${response.status}).`;
    throw new Error(message);
  }

  const credits = Array.isArray(data?.credits) ? data!.credits : [];
  return {
    availableCount: Math.max(0, toFiniteNumber(data?.available_count ?? data?.availableCount, 0)),
    credits: credits.map((credit: CodexCredit) => ({
      status: String(credit?.status || "unknown"),
      grantedAt: toIsoDate(credit?.granted_at ?? credit?.grantedAt),
      expiresAt: toIsoDate(credit?.expires_at ?? credit?.expiresAt),
    })),
  };
}

// Consume one Codex rate-limit reset credit (irreversible, spends 1 credit)
export async function consumeCodexRateLimitResetCredit(accessToken: string, redeemRequestId: string, proxyOptions: unknown = null): Promise<unknown> {
  if (!accessToken) {
    throw new Error("No Codex access token available. Please re-authorize the connection.");
  }
  if (!redeemRequestId || typeof redeemRequestId !== "string") {
    throw new Error("A redeem request id is required to consume a Codex reset credit.");
  }

  let response: { ok: boolean; status: number; text: () => Promise<string> };
  let data: CodexConsumeResponse | null = null;
  try {
    response = await proxyAwareFetch(CODEX_CONFIG.resetCreditsConsumeUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ redeem_request_id: redeemRequestId }),
    }, proxyOptions) as { ok: boolean; status: number; text: () => Promise<string> };

    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to consume Codex reset credit: ${(error as Error).message}`);
  }

  const code = data?.code || null;
  const windowsReset = toFiniteNumber(data?.windows_reset, 0);
  const success = response.ok && (code === "reset" || windowsReset > 0);

  return {
    ok: success,
    noCredit: response.ok && code === "no_credit",
    status: response.status,
    code,
    windowsReset,
    message: data?.message || null,
    raw: data,
  };
}
