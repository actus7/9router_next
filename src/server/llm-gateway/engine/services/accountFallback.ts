import { ERROR_RULES, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS } from "../config/errorConfig";

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

/**
 * True when the upstream rejected the request itself rather than the credential.
 * Scoped to account fallback: model-level fallback (combos) still retries these,
 * because a different model may accept a body the previous one rejected.
 */
export function isClientRequestError(status: number): boolean {
  return CLIENT_REQUEST_ERROR_STATUSES.has(Number(status));
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

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: matches ERROR_RULES top-to-bottom (text rules first, then status)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkFallbackError(status: number, errorText: string | unknown, backoffLevel = 0) {
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
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
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
