import "server-only";

/**
 * A fixed-window request counter, per account, held in this process.
 *
 * There was none at all: `POST /v1/chat/completions`, the provider test and
 * validate endpoints (each of which makes its own outbound request) and the
 * database import were all unbounded for any account that signed up. On a
 * deployment where anyone can create one, that is a way to burn the whole
 * install's provider quota, or its Neon compute, from a shell loop.
 *
 * Deliberately in-memory and deliberately per-process. It is a ceiling, not an
 * accounting system: on several instances each keeps its own count, so the real
 * limit is `limit × instances`. That still turns "unbounded" into "bounded",
 * which is the whole gap, and it costs no round trip on the hot path. A shared
 * counter belongs in the store the day per-plan quotas exist.
 *
 * ponytail: fixed window, not a sliding one — a burst can straddle the boundary
 * and land 2× the limit in an instant. Swap in a token bucket if that matters.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets: Map<string, Window> = new Map();

/** Windows are only cleaned when the map grows; there is no timer to leak. */
const MAX_TRACKED_KEYS = 50_000;

function sweep(now: number): void {
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. Meaningful only when `allowed` is false. */
  retryAfter: number;
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (limit <= 0) return { allowed: true, retryAfter: 0 };

  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Test seam. Production never needs to reset a window by hand. */
export function __resetRateLimits(): void {
  buckets.clear();
}

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Per-minute ceilings, per account. Both are far above what a person driving
 * the dashboard or a coding agent produces, so nothing legitimate notices them;
 * they exist to stop a loop. `0` disables a limit.
 */
export function gatewayRateLimit(): number {
  return readLimit("RATE_LIMIT_GATEWAY_PER_MINUTE", 600);
}

export function dashboardRateLimit(): number {
  return readLimit("RATE_LIMIT_DASHBOARD_PER_MINUTE", 1200);
}
