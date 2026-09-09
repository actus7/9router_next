import { currentTenantId } from "../tenant";

/**
 * Gateway key → `apiKeys.id`, cached.
 *
 * Every usage write resolves this, so it cannot be a query per request. Unlike
 * the connection cache in `usageRepo`, a miss forces a refresh rather than
 * giving up: a key minted seconds ago has to resolve immediately, because the
 * fallback is `usageHistory.apiKey` keeping the raw secret — in a table that is
 * never pruned, so rotating the key would not remove it.
 */
const KEY_CACHE_TTL_MS: number = 30 * 1000;
const KEY_CACHE_MIN_REFRESH_MS: number = 5 * 1000;
// Keyed by account, because `getApiKeys()` that fills it is. One shared entry
// meant account A's keys answered account B's lookups: B's key was a miss on a
// warm cache, `resolveApiKeyId` returned null inside the min-refresh window,
// and `saveRequestUsage` fell back to storing B's raw secret in usageHistory —
// a table with no pruning, so rotating the key never removed it.
const apiKeyIdCaches: Map<string, { map: Record<string, string>; ts: number }> = new Map();

function apiKeyIdCacheFor(tenantId: string): { map: Record<string, string>; ts: number } {
  let entry = apiKeyIdCaches.get(tenantId);
  if (!entry) {
    entry = { map: {}, ts: 0 };
    apiKeyIdCaches.set(tenantId, entry);
  }
  return entry;
}

async function refreshApiKeyIdCache(tenantId: string): Promise<Record<string, string>> {
  const { getApiKeys } = await import("./apiKeysRepo");
  const map: Record<string, string> = {};
  for (const k of await getApiKeys()) map[k.key] = k.id;
  const entry = apiKeyIdCacheFor(tenantId);
  entry.map = map;
  entry.ts = Date.now();
  return map;
}

export async function resolveApiKeyId(key: string): Promise<string | null> {
  const tenantId: string = currentTenantId();
  const entry = apiKeyIdCacheFor(tenantId);
  const age = Date.now() - entry.ts;
  if (age < KEY_CACHE_TTL_MS) {
    const hit = entry.map[key];
    if (hit) return hit;
    // Unknown key with a warm cache: refresh, but not on every request — a key
    // that is not ours at all would otherwise re-read the table each time.
    if (age < KEY_CACHE_MIN_REFRESH_MS) return null;
  }
  const map = await refreshApiKeyIdCache(tenantId);
  return map[key] ?? null;
}
