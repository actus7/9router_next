import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { makeKv } from "../helpers/kvStore";

const pricingKv = makeKv("pricing");
const CACHE_TTL_MS: number = 5000;

interface CacheEntry {
  value: Record<string, Record<string, unknown>> | null;
  expiresAt: number;
}

let cache: CacheEntry = { value: null, expiresAt: 0 };

function invalidate(): void {
  cache = { value: null, expiresAt: 0 };
}

async function getUserPricing(): Promise<Record<string, Record<string, unknown>>> {
  return await pricingKv.getAll() as Record<string, Record<string, unknown>>;
}

export async function getPricing(): Promise<Record<string, Record<string, unknown>>> {
  const now: number = Date.now();
  if (cache.value && cache.expiresAt > now) return cache.value;

  const userPricing: Record<string, Record<string, unknown>> = await getUserPricing();
  const { PROVIDER_PRICING } = await import("@/lib/open-sse/providers/pricing");
  const merged: Record<string, Record<string, unknown>> = {};

  for (const [provider, models] of Object.entries(PROVIDER_PRICING as Record<string, Record<string, unknown>>)) {
    merged[provider] = { ...models };
    if (userPricing[provider]) {
      for (const [model, pricing] of Object.entries(userPricing[provider])) {
        merged[provider][model] = merged[provider][model]
          ? { ...(merged[provider][model] as Record<string, unknown>), ...pricing as Record<string, unknown> }
          : pricing;
      }
    }
  }

  for (const [provider, models] of Object.entries(userPricing)) {
    if (!merged[provider]) {
      merged[provider] = { ...models };
    } else {
      for (const [model, pricing] of Object.entries(models)) {
        if (!merged[provider][model]) merged[provider][model] = pricing;
      }
    }
  }

  cache = { value: merged, expiresAt: now + CACHE_TTL_MS };
  return merged;
}

export async function getPricingForModel(provider: string, model: string): Promise<unknown | null> {
  if (!model) return null;
  const userPricing: Record<string, Record<string, unknown>> = await getUserPricing();
  if (provider && userPricing[provider]?.[model]) return userPricing[provider][model];
  const { getPricingForModel: resolveConst } = await import("@/lib/open-sse/providers/pricing");
  return resolveConst(provider, model);
}

// Atomic merge inside transaction (per-provider read-modify-write)
export async function updatePricing(pricingData: Record<string, Record<string, unknown>>): Promise<Record<string, Record<string, unknown>>> {
  const db = await getAdapter();
  db.transaction(() => {
    for (const [provider, models] of Object.entries(pricingData)) {
      const row: { value: string } | undefined = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      const current: Record<string, unknown> = row ? ((parseJson(row.value, {}) as Record<string, unknown>) || {}) : {};
      const merged: Record<string, unknown> = { ...current };
      for (const [model, pricing] of Object.entries(models)) {
        merged[model] = pricing;
      }
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(merged)]
      );
    }
  });
  invalidate();
  return await getUserPricing();
}

export async function resetPricing(provider?: string, model?: string): Promise<Record<string, Record<string, unknown>>> {
  if (!provider) return await getUserPricing();
  const db = await getAdapter();
  db.transaction(() => {
    if (!model) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      return;
    }
    const row: { value: string } | undefined = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    const current: Record<string, unknown> = row ? ((parseJson(row.value, {}) as Record<string, unknown>) || {}) : {};
    delete current[model];
    if (Object.keys(current).length === 0) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(current)]
      );
    }
  });
  invalidate();
  return await getUserPricing();
}

export async function resetAllPricing(): Promise<Record<string, unknown>> {
  await pricingKv.clear();
  invalidate();
  return {};
}
