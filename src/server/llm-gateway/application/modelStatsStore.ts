import { readModelPerf, recordModelAttempt } from "@/lib/db/repos/modelPerfRepo";
import { tryCurrentTenantId } from "@/lib/db/tenant";
import { aggregateModelStats, type ModelStat } from "@/shared/observability/modelStats";
import { setModelStatsStore } from "../engine/host/modelStats";

// Ranking and first-byte sizing read on every request; the rows move by one
// attempt at a time. A minute-old aggregate is as good as a live one.
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; stats: Map<string, ModelStat> }>();

export function resetModelStatsCache(): void {
  cache.clear();
}

async function read(): Promise<Map<string, ModelStat>> {
  const tenant = tryCurrentTenantId();
  if (!tenant) return new Map();
  const hit = cache.get(tenant);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stats;
  try {
    const stats = aggregateModelStats(await readModelPerf());
    cache.set(tenant, { at: Date.now(), stats });
    return stats;
  } catch {
    return new Map();
  }
}

/** Installs the database-backed store into the engine seam. Idempotent. */
export function installModelStatsStore(): void {
  setModelStatsStore({
    // Fire and forget: the upsert runs inside the request's tenant scope (it is
    // started synchronously from it) and a lost sample is not worth a failure.
    record: (datum) => { void recordModelAttempt(datum).catch(() => {}); },
    read,
  });
}
