import { ERROR_RULES, BACKOFF_CONFIG, COOLDOWN, TRANSIENT_COOLDOWN_MS } from "../config/errorConfig";
import { getErrorJudge, type ErrorJudgement } from "../host/errorJudge";

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

// Statuses that mean "this request is malformed", not "this account is spent".
// Retrying the identical body on another account reproduces the same failure,
// so account rotation must not treat them as a reason to cool an account down.
const CLIENT_REQUEST_ERROR_STATUSES: ReadonlySet<number> = new Set([400, 413, 422]);

// A provider that fans an alias out to several upstreams (kilo-gateway,
// OpenRouter) rejects a request carrying `tools` when nothing behind that alias
// does tool calling — every `:free` variant tends to be one. It arrives as a
// 404, but it is a statement about the body, not about the credential.
const TOOL_UNSUPPORTED = [
  /no endpoints? found that support tool use/i,
  /(tool use|tool calling|tool_calls|function calling|tools) (is |are )?not supported/i,
  /(does not|doesn't) support (tool|function)/i,
  /unsupported .{0,24}(tool|function[ _-]?call)/i,
];

/**
 * Ask the installed error judge what kind of upstream failure this was.
 *
 * Jev-first wrapper over the host seam: serialises the error exactly like the
 * regexes below do, and answers null whenever there is no judge, the judge
 * declines (off, timeout, low confidence) or anything throws — so every caller
 * keeps its existing heuristics untouched.
 */
export async function judgeUpstreamError(input: {
  status?: number | null;
  errorText: string | unknown;
  provider: string;
}): Promise<ErrorJudgement | null> {
  const judge = getErrorJudge();
  if (!judge) return null;
  const text = typeof input.errorText === "string"
    ? input.errorText
    : input.errorText ? JSON.stringify(input.errorText) : "";
  try {
    return (await judge({ status: input.status ?? null, errorText: text, provider: input.provider })) ?? null;
  } catch {
    return null;
  }
}

/** Whether an upstream error says the model cannot do tool calling. */
export function isToolUnsupportedError(errorText: string | unknown, judged?: ErrorJudgement | null): boolean {
  // Jev first: it catches phrasings the patterns below never listed. A null
  // judgement keeps the regexes exactly as they were.
  if (judged?.kind === "tool_unsupported") return true;
  const text = typeof errorText === "string" ? errorText : errorText ? JSON.stringify(errorText) : "";
  return text ? TOOL_UNSUPPORTED.some((re) => re.test(text)) : false;
}

/**
 * True when the upstream rejected the request itself rather than the credential.
 * Scoped to account fallback: model-level fallback (combos) still retries these,
 * because a different model may accept a body the previous one rejected.
 *
 * "This model has no tool-calling endpoint" belongs here for the same reason a
 * 400 does — the next account reproduces it — even though it arrives as a 404,
 * which otherwise does mean "not on this account" and is worth rotating for.
 */
export function isClientRequestError(status: number, errorText?: string | unknown, judged?: ErrorJudgement | null): boolean {
  if (judged?.kind === "tool_unsupported") return true;
  if (CLIENT_REQUEST_ERROR_STATUSES.has(Number(status))) return true;
  return isToolUnsupportedError(errorText);
}

/** What `getProviderCredentials` reports when it has nothing usable left. */
export interface ExhaustedCredentials {
  allRateLimited?: boolean;
  retryAfter?: number | string;
  retryAfterHuman?: string;
  lastError?: string;
  lastErrorCode?: number | string;
}

export type AccountExhaustion =
  /** Every account exists but is cooling down; the caller should send Retry-After. */
  | { kind: "rate-limited"; status: number; message: string; retryAfter: string; retryAfterHuman: string }
  /** The operator configured no usable account for this provider at all. */
  | { kind: "no-accounts"; status: 404; message: string }
  /** Accounts existed, every one was tried, all failed. */
  | { kind: "exhausted"; status: number; message: string };

/**
 * Decide what "no account left" means for one request.
 *
 * The three outcomes were duplicated inline in the chat loop, the embeddings
 * loop and the Gemini-native forwarder, and they drifted: the same
 * no-account-configured condition answered 404 on chat and 400 on embeddings.
 *
 * Only this decision is shared, not the loops around it. Those genuinely differ
 * — chat carries the routing trace, the free-default fallback, project-id
 * enrichment and the noAuth cooldown; embeddings writes usage inline; the Gemini
 * path forwards rather than translates. A skeleton taking a callback for each of
 * those would be an abstraction with one shape per caller, which is worse than
 * three explicit loops. This is the part that actually drifted, so this is the
 * part that gets one owner.
 */
export function resolveAccountExhaustion(
  provider: string,
  model: string,
  credentials: ExhaustedCredentials | null | undefined,
  triedCount: number,
  lastError: string | null,
  lastStatus: number | null,
): AccountExhaustion {
  if (credentials?.allRateLimited) {
    const message = lastError || credentials.lastError || "Unavailable";
    return {
      kind: "rate-limited",
      status: lastStatus || Number(credentials.lastErrorCode) || 503,
      message: `[${provider}/${model}] ${message}`,
      retryAfter: String(credentials.retryAfter ?? ""),
      retryAfterHuman: credentials.retryAfterHuman ?? "",
    };
  }
  if (triedCount === 0) {
    // Nothing was ever tried, so this is a configuration gap, not a failure.
    // 404 and not 400: the caller's request is well-formed, and it matches the
    // OpenAI convention for a model that cannot be served.
    return {
      kind: "no-accounts",
      status: 404,
      message: `No active credentials for provider: ${provider}`,
    };
  }
  return {
    kind: "exhausted",
    status: lastStatus || 503,
    message: lastError || "All accounts unavailable",
  };
}

/** What a failure means for account rotation: rotate (and for how long) or not. */
export interface FallbackDecision {
  shouldFallback: boolean;
  cooldownMs: number;
  newBackoffLevel?: number;
}

/**
 * Map a judge verdict onto the fallback decision, Jev-first.
 *
 * The kind list below is the whole point of unifying the ~21 regex/status rules:
 * one calibrated classification replaces guessing which rule a message hit.
 * A null judgement never reaches here — `checkFallbackError` keeps the rules.
 */
export function fallbackDecisionFromJudgement(judged: ErrorJudgement, backoffLevel = 0): FallbackDecision {
  switch (judged.kind) {
    // Spent for now: same exponential backoff the `backoff: true` rules use.
    case "rate_limit":
    case "quota":
    case "capacity": {
      const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
      return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
    }
    // The credential or the bill is broken: rotating may still serve the
    // request, but this account is out for the long cooldown.
    case "auth_expired":
    case "billing":
    case "permanent":
    case "github_monthly":
      return { shouldFallback: true, cooldownMs: COOLDOWN.long };
    // Temporary infrastructure failure: retry, but not for long.
    case "transient":
      return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
    // A refused prompt is not a spent account — long would punish the next
    // innocent request for one bad message. Rotate without a 2min lockout.
    case "moderation":
      return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
    // The body is wrong: every account reproduces it, so no rotation and no
    // cooldown (same verdict as `isClientRequestError`).
    case "client_request":
    case "tool_unsupported":
      return { shouldFallback: false, cooldownMs: 0 };
    default:
      return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
  }
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Jev-first: a present `judged` verdict decides through
 * `fallbackDecisionFromJudgement`; otherwise, config-driven as always —
 * matches ERROR_RULES top-to-bottom (text rules first, then status).
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @param {ErrorJudgement | null} judged - Judge verdict, when one was asked
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkFallbackError(status: number, errorText: string | unknown, backoffLevel = 0, judged?: ErrorJudgement | null): FallbackDecision {
  if (judged) return fallbackDecisionFromJudgement(judged, backoffLevel);

  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  for (const rule of ERROR_RULES) {
    // Text-based rule: match substring in error message
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0 };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0 };
    }
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil: string) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}
