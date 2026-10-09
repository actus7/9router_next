import { waitUntil } from "@vercel/functions";
import { pruneModelPerf, readModelPerf, recordModelAttempt } from "@/lib/db/repos/modelPerfRepo";
import { tryCurrentTenantId } from "@/lib/db/tenant";
import { aggregateModelStats, type ModelStat } from "@/shared/observability/modelStats";
import { setModelStatsStore } from "../engine/host/modelStats";

// Ranking and first-byte sizing read on every request; the rows move by one
// attempt at a time. A minute-old aggregate is as good as a live one.
const CACHE_TTL_MS = 60_000;

// A failed read is cached too, briefly: while the database is struggling every
// smart request would otherwise retry the read and wait on it.
const ERROR_TTL_MS = 10_000;
const PRUNE_EVERY_MS = 6 * 3_600_000;

const cache = new Map<string, { at: number; ttl: number; stats: Map<string, ModelStat> }>();
const inFlight = new Map<string, Promise<Map<string, ModelStat>>>();
const lastPruned = new Map<string, number>();

export function resetModelStatsCache(): void {
  cache.clear();
  inFlight.clear();
  lastPruned.clear();
}

function pruneOccasionally(tenant: string): void {
  if (Date.now() - (lastPruned.get(tenant) ?? 0) < PRUNE_EVERY_MS) return;
  lastPruned.set(tenant, Date.now());
  void pruneModelPerf().catch(() => {});
}

async function read(): Promise<Map<string, ModelStat>> {
  const tenant = tryCurrentTenantId();
  if (!tenant) return new Map();
  const hit = cache.get(tenant);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.stats;
  // One read per tenant at a time: a cold cache must not fan out into N queries.
  const pending = inFlight.get(tenant);
  if (pending) return pending;
  const load = (async () => {
    try {
      const stats = aggregateModelStats(await readModelPerf());
      cache.set(tenant, { at: Date.now(), ttl: CACHE_TTL_MS, stats });
      pruneOccasionally(tenant);
      return stats;
    } catch {
      const empty = new Map<string, ModelStat>();
      cache.set(tenant, { at: Date.now(), ttl: ERROR_TTL_MS, stats: empty });
      return empty;
    } finally {
      inFlight.delete(tenant);
    }
  })();
  inFlight.set(tenant, load);
  return load;
}

/** Installs the database-backed store into the engine seam. Idempotent. */
export function installModelStatsStore(): void {
  setModelStatsStore({
    // The upsert starts inside the request's tenant scope. waitUntil keeps a
    // serverless invocation alive long enough to finish it; a lost sample is
    // still not worth a failure.
    record: (datum) => {
      const write = recordModelAttempt(datum).catch(() => {});
      try { waitUntil(write); } catch { /* not on a platform that has it */ }
    },
    read,
  });
}
