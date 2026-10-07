/**
 * Antigravity live quota cache — in-memory, refreshed on demand.
 * Read by the account pre-filter to skip accounts whose model quota is exhausted;
 * also fed by the 409/429 handler to learn the exact resetAt from upstream.
 * Per-process by design (best effort on serverless): a cold instance just asks upstream again.
 */
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getAntigravityUsage } from "../engine/services/usage/google";
import * as log from "../utils/logger";

export interface AntigravityModelQuota { remainingPercentage: number; resetAt?: string | null }
type QuotaMap = Record<string, AntigravityModelQuota>;

const quotaCache = new Map<string, QuotaMap>();
const lastRefreshAt = new Map<string, number>();
const inflightRefresh = new Map<string, Promise<QuotaMap | null>>();

const MIN_REFRESH_INTERVAL_MS = 30_000; // per connection

// Strike breaker: Google's quota API can report remaining quota while generation keeps
// returning 429 (sprint/weekly dual-pool mismatch). STRIKE_THRESHOLD 429s inside the
// window for one connection+model make the optimistic reading untrusted: block the pair.
const STRIKE_WINDOW_MS = 60_000;
const STRIKE_THRESHOLD = 3;
const STRIKE_BLOCK_MS = 15 * 60_000;
const strikeCounts = new Map<string, { count: number; windowStart: number }>();
const strikeBlocks = new Map<string, number>(); // "connectionId|model" → blockedUntil ms

const pairKey = (connectionId: string, model: string) => `${connectionId}|${model}`;
const shortId = (connectionId: string) => connectionId.slice(0, 8);

/** Re-assert active strike blocks on a fresh snapshot so an optimistic reading cannot undo them. */
function applyActiveStrikeBlocks(connectionId: string, quotas: QuotaMap): QuotaMap {
  const now = Date.now();
  for (const [key, until] of strikeBlocks) {
    if (!key.startsWith(`${connectionId}|`)) continue;
    if (until <= now) {
      strikeBlocks.delete(key);
      continue;
    }
    quotas[key.slice(connectionId.length + 1)] = { remainingPercentage: 0, resetAt: new Date(until).toISOString() };
  }
  return quotas;
}

/** A success makes "consecutive" strikes mean consecutive. Only a synthesized block is removed; a real 0% reading stays. */
export function clearAntigravityStrikes(connectionId: string, model: string): void {
  const key = pairKey(connectionId, model);
  strikeCounts.delete(key);
  const until = strikeBlocks.get(key);
  if (until === undefined) return;
  strikeBlocks.delete(key);
  const cached = quotaCache.get(connectionId);
  if (cached?.[model]?.resetAt === new Date(until).toISOString()) delete cached[model];
}

/** ISO resetAt while the cache says this connection has no quota left for the model, else null. */
export function antigravityQuotaBlockedUntil(connectionId: string, model: string): string | null {
  const quota = quotaCache.get(connectionId)?.[model];
  if (!quota || quota.remainingPercentage > 0 || !quota.resetAt) return null;
  return new Date(quota.resetAt).getTime() > Date.now() ? quota.resetAt : null;
}

async function doRefresh(connectionId: string, accessToken: string, providerSpecificData: Record<string, unknown>): Promise<QuotaMap | null> {
  try {
    const proxyCfg = await resolveConnectionProxyConfig(providerSpecificData || {});
    const proxyOptions = {
      connectionProxyEnabled: proxyCfg.connectionProxyEnabled === true,
      connectionProxyUrl: proxyCfg.connectionProxyUrl || "",
      connectionNoProxy: proxyCfg.connectionNoProxy || "",
      vercelRelayUrl: proxyCfg.vercelRelayUrl || "",
      strictProxy: proxyCfg.strictProxy === true,
    };
    const usage = (await getAntigravityUsage(accessToken, providerSpecificData, proxyOptions)) as { quotas?: QuotaMap; message?: string } | null;
    // 401/403 usage responses carry an empty quotas object plus a message — keep the known cache.
    if (!usage?.quotas || usage.message) return null;
    quotaCache.set(connectionId, applyActiveStrikeBlocks(connectionId, usage.quotas));
    return usage.quotas;
  } catch (e) {
    log.warn("AG_QUOTA", `${shortId(connectionId)} | refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Refresh one connection's quota from upstream; coalesces concurrent calls and throttles per connection. */
export async function refreshAntigravityQuota(connectionId: string, accessToken: string, providerSpecificData: Record<string, unknown>): Promise<QuotaMap | null> {
  const inflight = inflightRefresh.get(connectionId);
  if (inflight) return inflight;

  const now = Date.now();
  const lastRefresh = lastRefreshAt.get(connectionId) || 0;
  if (now - lastRefresh < MIN_REFRESH_INTERVAL_MS) return quotaCache.get(connectionId) || null;

  // Every attempt counts, so failed quota calls cannot amplify an upstream 429 burst.
  lastRefreshAt.set(connectionId, now);
  const promise = doRefresh(connectionId, accessToken, providerSpecificData);
  inflightRefresh.set(connectionId, promise);
  try {
    return await promise;
  } finally {
    inflightRefresh.delete(connectionId);
  }
}

/**
 * Antigravity 409/429: refresh the cache and return the model's resetAt (ms) when it is
 * exhausted, so the caller can block the pair until then. Null means "no exact answer".
 */
export async function handleAntigravityQuotaError(connectionId: string, status: number, model: string, accessToken: string, providerSpecificData: Record<string, unknown>): Promise<number | null> {
  if (status !== 409 && status !== 429) return null;
  log.info("AG_QUOTA", `${shortId(connectionId)} | ${status} on ${model} — refreshing quota`);
  const quota = (await refreshAntigravityQuota(connectionId, accessToken, providerSpecificData))?.[model];

  // A 429 whose reading is optimistic (>0) or unavailable counts as a strike; 409 counts too
  // (Antigravity signals pool exhaustion with it). Poisoning needs STRIKE_THRESHOLD in the window.
  if (!quota || quota.remainingPercentage > 0) {
    const key = pairKey(connectionId, model);
    const now = Date.now();
    const strike = strikeCounts.get(key);
    // Fixed window anchored at the FIRST strike, not sliding.
    const inWindow = strike !== undefined && now - strike.windowStart <= STRIKE_WINDOW_MS;
    const count = inWindow ? strike.count + 1 : 1;
    strikeCounts.set(key, { count, windowStart: inWindow ? strike.windowStart : now });
    if (count < STRIKE_THRESHOLD) return null;

    strikeCounts.delete(key);
    const blockedUntil = now + STRIKE_BLOCK_MS;
    const reading = quota ? `${Math.round(quota.remainingPercentage)}%` : "unknown";
    log.warn("AG_QUOTA", `${shortId(connectionId)} | STRIKE_${status} ${model} — ${count}x (quota ${reading}); CACHE_BLOCK 15m`);
    // Synthesize a 0% entry so the pre-filter skips this pair on later requests too.
    const cached = quotaCache.get(connectionId) || {};
    cached[model] = { remainingPercentage: 0, resetAt: new Date(blockedUntil).toISOString() };
    quotaCache.set(connectionId, cached);
    strikeBlocks.set(key, blockedUntil);
    return blockedUntil;
  }

  // Healthy-but-exhausted reading: clear strikes and use the exact resetAt.
  strikeCounts.delete(pairKey(connectionId, model));
  if (!quota.resetAt) return null;
  const resetMs = new Date(quota.resetAt).getTime();
  if (resetMs <= Date.now()) return null;
  log.warn("AG_QUOTA", `${shortId(connectionId)} | UPSTREAM_${status} ${model} — exhausted; CACHE_BLOCK until ${quota.resetAt}`);
  return resetMs;
}
