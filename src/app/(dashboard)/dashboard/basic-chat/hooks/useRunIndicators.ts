"use client";

import { useEffect, useState } from "react";

/** What the history list shows next to a conversation. */
export type RunIndicator = "working" | "finished" | "failed";

/**
 * How often the sidebar asks which conversations are busy.
 *
 * A badge, not a stream: nobody is reading the sidebar token by token, and the
 * endpoint is behind the dashboard rate limit. Slow enough to be cheap, quick
 * enough that a finished run does not sit unannounced.
 */
const POLL_INTERVAL_MS = 8_000;

interface RunStateRow {
  sessionId: string;
  status: "running" | "completed" | "failed" | "stopped";
}

function indicatorFor(status: RunStateRow["status"]): RunIndicator | null {
  if (status === "running") return "working";
  if (status === "failed") return "failed";
  // `stopped` was the user's own doing and needs no announcement.
  return status === "completed" ? "finished" : null;
}

function sameIndicators(a: Map<string, RunIndicator>, b: Map<string, RunIndicator>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/**
 * Which conversations have something going on, keyed by session id.
 *
 * A conversation is only listed while a run of its own is unread: opening it
 * folds the finished run in and deletes the row, so the badge clears itself
 * without anyone having to remember to clear it. A run still working keeps its
 * badge while it works, open or not — that one is still true.
 *
 * Polls rather than streams, and only while the tab is visible: a background
 * tab that keeps a connection open costs the same as one being read.
 */
export function useRunIndicators(): Map<string, RunIndicator> {
  const [indicators, setIndicators] = useState<Map<string, RunIndicator>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      const response = await fetch("/api/harness/runs", { signal: controller.signal }).catch(() => null);
      if (!response?.ok || cancelled) return;

      const { states } = (await response.json().catch(() => ({ states: [] }))) as { states: RunStateRow[] };
      const next = new Map<string, RunIndicator>();
      for (const state of states) {
        const indicator = indicatorFor(state.status);
        if (!indicator) continue;
        // Working outranks finished: a conversation with a new run in flight
        // is working, whatever an older settled run of its own still says.
        if (indicator === "working" || !next.has(state.sessionId)) next.set(state.sessionId, indicator);
      }
      if (cancelled) return;
      // Same badges as last time is the common case — no run anywhere. Handing
      // React a fresh Map anyway re-renders the whole sidebar every 8s.
      setIndicators((current) => (sameIndicators(current, next) ? current : next));
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    // Coming back to the tab should not wait out the interval.
    document.addEventListener("visibilitychange", poll);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  return indicators;
}
