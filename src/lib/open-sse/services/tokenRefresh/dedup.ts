import type { Logger } from "../types";

const REFRESH_RESULT_TTL_MS = 10_000;
const refreshDedupCache = new Map<string, { promise?: Promise<unknown>; result?: unknown; expiresAt?: number }>();

export async function dedupRefresh<T>(provider: string, oldToken: string, fn: () => Promise<T>, log?: Logger): Promise<T> {
  if (!oldToken) return fn();
  const key = `${provider}:${oldToken}`;
  const hit = refreshDedupCache.get(key);
  if (hit) {
    if (hit.promise) {
      log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
      return hit.promise as Promise<T>;
    }
    if (hit.expiresAt != null && hit.expiresAt > Date.now()) {
      log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
      return hit.result as T;
    }
    refreshDedupCache.delete(key);
  }
  const promise = (async () => {
    try {
      const result = await fn();
      refreshDedupCache.set(key, { result, expiresAt: Date.now() + REFRESH_RESULT_TTL_MS });
      return result;
    } catch (err) {
      refreshDedupCache.delete(key);
      throw err;
    }
  })();
  refreshDedupCache.set(key, { promise });
  return promise;
}
