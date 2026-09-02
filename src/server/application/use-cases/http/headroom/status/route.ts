import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";

export const dynamic = "force-dynamic";

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

let cache: CachedEntry | null = null;

/** Reset the coalescing cache. Exported for testing only. */
export function resetHeadroomStatusCache(): void {
  cache = null;
}

function getCachedResult(): unknown | null {
  if (!cache || cache.resolvedAt === null) return null;
  if (Date.now() - cache.resolvedAt > CACHE_TTL_MS) {
    cache = null; // expired
    return null;
  }
  return cache.result;
}

function startComputation(url: string): Promise<unknown> {
  const p: Promise<unknown> = (async () => {
    const status = await getHeadroomStatus(url);
    const managedPid = getManagedPid();
    return { ...status, url, managedPid };
  })();

  const entry: CachedEntry = { promise: p, resolvedAt: null, result: null };
  cache = entry;

  p.then(
    (value: unknown) => {
      entry.resolvedAt = Date.now();
      entry.result = value;
    },
    () => {
      // On error, discard the cache entry so the next request retries.
      if (cache === entry) cache = null;
    },
  );

  return p;
}

export async function GET() {
  try {
    // Short-circuit: serve from cache if still valid.
    const cached = getCachedResult();
    if (cached !== null) {
      return NextResponse.json(cached);
    }

    // If a computation is already in-flight, share it; otherwise start one.
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;

    if (cache && cache.resolvedAt === null) {
      // Reuse in-flight promise (settings resolution is cheap; url may differ
      // only if settings changed mid-flight — acceptable for a 2s window).
      const result = await cache.promise;
      return NextResponse.json(result);
    }

    const result = await startComputation(url);
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
