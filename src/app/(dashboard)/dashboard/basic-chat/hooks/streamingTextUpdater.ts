/**
 * Decouples how fast text arrives from how often React and the session store
 * hear about it.
 *
 * Chunks land at network rate; the screen can show one frame at a time, and
 * persisting the session rewrites every message and kicks the sync timer. So
 * the latest text is applied once per frame, and written to the session at most
 * once per `persistIntervalMs`. `flush` makes the last write exact — call it
 * before anything that reads the stored message.
 */
export interface StreamingTextUpdaterOptions {
  /** Cheap, per frame: live streaming text and activity labels. */
  applyFrame: (text: string) => void;
  /** Expensive, throttled: writes the text into the stored session. */
  persist: (text: string) => void;
  persistIntervalMs?: number;
  /** Returns a canceller. Defaults to `requestAnimationFrame`, else a 16ms timer. */
  schedule?: (callback: () => void) => () => void;
  now?: () => number;
}

export interface StreamingTextUpdater {
  push: (text: string) => void;
  flush: () => void;
  cancel: () => void;
}

const DEFAULT_PERSIST_INTERVAL_MS = 500;
const FALLBACK_FRAME_MS = 16;

function defaultSchedule(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, FALLBACK_FRAME_MS);
  return () => clearTimeout(id);
}

export function createStreamingTextUpdater(options: StreamingTextUpdaterOptions): StreamingTextUpdater {
  const {
    applyFrame,
    persist,
    persistIntervalMs = DEFAULT_PERSIST_INTERVAL_MS,
    schedule = defaultSchedule,
    now = Date.now,
  } = options;

  let latest = "";
  let persisted: string | null = null;
  let lastPersistAt = Number.NEGATIVE_INFINITY;
  let cancelFrame: (() => void) | null = null;

  const persistLatest = () => {
    if (latest === persisted) return;
    persisted = latest;
    lastPersistAt = now();
    persist(latest);
  };

  const frame = () => {
    cancelFrame = null;
    applyFrame(latest);
    if (now() - lastPersistAt >= persistIntervalMs) persistLatest();
  };

  return {
    push(text) {
      latest = text;
      if (!cancelFrame) cancelFrame = schedule(frame);
    },
    flush() {
      if (cancelFrame) {
        cancelFrame();
        cancelFrame = null;
        applyFrame(latest);
      }
      persistLatest();
    },
    cancel() {
      cancelFrame?.();
      cancelFrame = null;
    },
  };
}
