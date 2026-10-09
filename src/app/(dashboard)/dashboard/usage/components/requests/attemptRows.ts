import type { RequestAttempt } from "./types";

export type AttemptTone = "ok" | "failed" | "skipped";

export interface AttemptRow {
  number: number;
  model: string;
  provider?: string;
  connection?: string;
  tone: AttemptTone;
  /** What the badge shows: the HTTP status, or a short word when there is none. */
  badge: string;
  status?: number;
  errorClass?: string;
  error?: string;
  durationMs?: number;
  startOffsetMs?: number;
  /** The model the request moved on to after this attempt failed. */
  fallbackTo?: { model: string; number: number };
}

const TONE: Record<RequestAttempt["outcome"], AttemptTone> = {
  ok: "ok",
  failed: "failed",
  aborted: "failed",
  cooldown_skip: "skipped",
};

function badgeOf(attempt: RequestAttempt): string {
  if (attempt.status !== undefined) return String(attempt.status);
  return attempt.outcome === "cooldown_skip" ? "cooldown" : attempt.outcome === "ok" ? "200" : "error";
}

/** The ATTEMPTS list: one row per try, each failure pointing at what came next. */
export function buildAttemptRows(attempts: RequestAttempt[] | null | undefined): AttemptRow[] {
  if (!attempts?.length) return [];
  return attempts.map((attempt, i) => {
    const next = attempts[i + 1];
    return {
      number: i + 1,
      model: attempt.model,
      provider: attempt.provider,
      connection: attempt.connection,
      tone: TONE[attempt.outcome] ?? "failed",
      badge: badgeOf(attempt),
      status: attempt.status,
      errorClass: attempt.errorClass,
      error: attempt.error,
      durationMs: attempt.durationMs,
      startOffsetMs: attempt.startOffsetMs,
      ...(attempt.outcome !== "ok" && next ? { fallbackTo: { model: next.model, number: i + 2 } } : {}),
    };
  });
}
