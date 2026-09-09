import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { currentTenantId } from "@/lib/db/tenant";


// --- Request coalescing with short TTL cache ---
// Concurrent callers share the same in-flight computation.
// After a successful result, it is cached for a short TTL so that
// immediately-subsequent requests reuse it without re-invoking the
// expensive getHeadroomStatus (which shells out to pip/fetch).
// Errors are never cached — the next request retries immediately.
const CACHE_TTL_MS = 2000;

interface CachedEntry {
  promise: Promise<unknown>;
  resolvedAt: number | null; // null while still in-flight
  result: unknown | null;
}

// Keyed by account: the cached payload carries that account's `headroomUrl`,
// so one shared entry handed it to every other account for the TTL.
const caches: Map<string, CachedEntry> = new Map();

/** Reset the coalescing cache. Exported for testing only. */
export function resetHeadroomStatusCache(): void {
  caches.clear();
}

function getCachedResult(tenantId: string): unknown | null {
  const cache = caches.get(tenantId);
  if (!cache || cache.resolvedAt === null) return null;
  if (Date.now() - cache.resolvedAt > CACHE_TTL_MS) {
    caches.delete(tenantId); // expired
    return null;
  }
  return cache.result;
}

function startComputation(tenantId: string, url: string): Promise<unknown> {
  const p: Promise<unknown> = (async () => {
    const status = await getHeadroomStatus(url);
    const managedPid = getManagedPid();
    return { ...status, url, managedPid };
  })();

  const entry: CachedEntry = { promise: p, resolvedAt: null, result: null };
  caches.set(tenantId, entry);

  p.then(
    (value: unknown) => {
      entry.resolvedAt = Date.now();
      entry.result = value;
    },
    () => {
      // On error, discard the cache entry so the next request retries.
      if (caches.get(tenantId) === entry) caches.delete(tenantId);
    },
  );

  return p;
}

export async function GET() {
  await assertRequestRuntime();
  try {
    const tenantId: string = currentTenantId();
    // Short-circuit: serve from cache if still valid.
    const cached = getCachedResult(tenantId);
    if (cached !== null) {
      return NextResponse.json(cached);
    }

    // If a computation is already in-flight, share it; otherwise start one.
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;

    const inFlight = caches.get(tenantId);
    if (inFlight && inFlight.resolvedAt === null) {
      // Reuse in-flight promise (settings resolution is cheap; url may differ
      // only if settings changed mid-flight — acceptable for a 2s window).
      const result = await inFlight.promise;
      return NextResponse.json(result);
    }

    const result = await startComputation(tenantId, url);
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
