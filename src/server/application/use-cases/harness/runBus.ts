/**
 * In-process channel between a run's worker and the watchers reading it.
 *
 * The database stays the source of truth and the only channel *across*
 * instances. This is the shortcut for the common case — worker and watcher in
 * the same process — so text reaches the reader as it is produced instead of
 * after the next write-then-poll round trip.
 *
 * `null` carries no text: it means "the row changed, go read it" (settled).
 */
export type RunListener = (text: string | null) => void;

// Route handlers and the worker can be bundled as separate module instances
// (Next dev), so the registry lives on globalThis rather than in this module.
const REGISTRY_KEY = Symbol.for("modelhub.runBus");
type GlobalWithBus = typeof globalThis & { [REGISTRY_KEY]?: Map<string, Set<RunListener>> };

function registry(): Map<string, Set<RunListener>> {
  const holder = globalThis as GlobalWithBus;
  return (holder[REGISTRY_KEY] ??= new Map());
}

export function subscribeRun(runId: string, listener: RunListener): () => void {
  const all = registry();
  const set = all.get(runId) ?? new Set<RunListener>();
  set.add(listener);
  all.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0 && all.get(runId) === set) all.delete(runId);
  };
}

export function publishRunText(runId: string, text: string | null): void {
  const set = registry().get(runId);
  if (!set) return;
  // Copy: a listener may unsubscribe while we iterate.
  for (const listener of [...set]) {
    try {
      listener(text);
    } catch {
      // One broken watcher must not stop the worker or the other watchers.
    }
  }
}
