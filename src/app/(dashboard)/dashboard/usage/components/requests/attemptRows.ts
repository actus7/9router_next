import type { RequestAttempt } from "./types";

/** `cancelled` is a hedge loser: it was stopped because another model answered
 *  first, which is the gateway working, not a model failing. */
export type AttemptTone = "ok" | "failed" | "skipped" | "cancelled";

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
  /** Started while the previous attempt was still running (a hedge). */
  parallel: boolean;
  freeFallback: boolean;
  /** The model the request moved on to after this attempt failed. */
  fallbackTo?: { model: string; number: number; sameModel: boolean };
}

const TONE: Record<RequestAttempt["outcome"], AttemptTone> = {
  ok: "ok",
  failed: "failed",
  aborted: "cancelled",
  cooldown_skip: "skipped",
};

function badgeOf(attempt: RequestAttempt): string {
  if (attempt.status !== undefined) return String(attempt.status);
  if (attempt.outcome === "cooldown_skip") return "cooldown";
  if (attempt.outcome === "aborted") return "cancelled";
  return attempt.outcome === "ok" ? "200" : "error";
}

/**
 * The sentence inside a provider's error, when the error is its JSON body
 * (`[429]: {"error":{"message":"…"}}`). Anything that does not parse, such as
 * a body cut short by the trace limit, comes back as written.
 */
export function readableError(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.replace(/^\[\d{3}\]:\s*/, "").trim();
  try {
    const parsed: unknown = JSON.parse(text);
    const message = messageOf(parsed);
    if (message) return message;
  } catch {
    // Not JSON: plain text already reads fine.
  }
  return text;
}

function messageOf(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return messageOf(record.message) ?? messageOf(record.error) ?? messageOf(record.detail);
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function endOf(attempt: RequestAttempt): number | undefined {
  if (attempt.startOffsetMs === undefined || attempt.durationMs === undefined) return undefined;
  return attempt.startOffsetMs + attempt.durationMs;
}

/** One row per try, in order, each failure pointing at what came next. */
export function buildAttemptRows(attempts: RequestAttempt[] | null | undefined): AttemptRow[] {
  if (!attempts?.length) return [];
  return attempts.map((attempt, i) => {
    const prev = attempts[i - 1];
    const next = attempts[i + 1];
    const prevEnd = prev ? endOf(prev) : undefined;
    const tone = TONE[attempt.outcome] ?? "failed";
    return {
      number: i + 1,
      model: attempt.model,
      provider: attempt.provider,
      connection: attempt.connection,
      tone,
      badge: badgeOf(attempt),
      status: attempt.status,
      errorClass: attempt.errorClass,
      error: attempt.error,
      durationMs: attempt.durationMs,
      startOffsetMs: attempt.startOffsetMs,
      freeFallback: attempt.freeFallback === true,
      parallel: attempt.startOffsetMs !== undefined && prevEnd !== undefined && attempt.startOffsetMs < prevEnd,
      ...((tone === "failed" || tone === "skipped") && next ? { fallbackTo: { model: next.model, number: i + 2, sameModel: next.model === attempt.model } } : {}),
    };
  });
}

export interface AttemptSummary {
  answeredBy?: AttemptRow;
  failures: number;
  skipped: number;
  cancelled: number;
  /** End of the last attempt, measured from the request start. */
  totalMs?: number;
}

/** The headline of the story: who answered and what it took to get there. */
export function summarizeAttempts(rows: AttemptRow[]): AttemptSummary {
  const count = (tone: AttemptTone) => rows.filter((r) => r.tone === tone).length;
  const ends = rows.flatMap((r) =>
    r.startOffsetMs !== undefined && r.durationMs !== undefined ? [r.startOffsetMs + r.durationMs] : [],
  );
  return {
    answeredBy: rows.find((r) => r.tone === "ok"),
    failures: count("failed"),
    skipped: count("skipped"),
    cancelled: count("cancelled"),
    totalMs: ends.length ? Math.max(...ends) : undefined,
  };
}
