"use client";

/**
 * One call site for /api/models/test. Five places used to build this request
 * themselves, each normalizing the answer a little differently, so a model
 * could read as reachable on one screen and unreachable on another.
 * Retry policy stays in modelTestHelpers; this is the single probe.
 */
export interface ModelProbeResult {
  status: "ok" | "error";
  /** Empty string when the probe passed, so callers can render it directly. */
  error: string;
  latencyMs?: number;
  httpStatus?: number;
  /** The gateway timed out rather than refusing: worth retrying. */
  isTimeout?: boolean;
  /** The caller's AbortSignal fired. Not a model failure. */
  cancelled?: boolean;
}

export interface ModelProbeOptions {
  kind?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function probeModel(model: string, options: ModelProbeOptions = {}): Promise<ModelProbeResult> {
  const { kind, timeoutMs, signal } = options;
  try {
    const res = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        ...(kind ? { kind } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
      }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      return { status: "ok", error: "", latencyMs: data.latencyMs, httpStatus: data.status };
    }
    return {
      status: "error",
      error: data.error || "",
      httpStatus: data.status,
      isTimeout: data.isTimeout === true,
    };
  } catch (err: unknown) {
    if (signal?.aborted) return { status: "error", error: "", cancelled: true };
    return { status: "error", error: err instanceof Error ? err.message : "" };
  }
}
