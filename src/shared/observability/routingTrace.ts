// What the gateway did to answer one request: which combo was resolved, how
// smart routing decided, every model it tried and why each failed, and which
// account finally answered. Travels on a response header so the chat can show
// it even when persisted observability is off.

export const ROUTING_TRACE_HEADER = "X-ModelHub-Routing";

// A header is not a log: keep the value small enough that no proxy or runtime
// rejects the response, and drop detail before dropping the whole trace.
export const ROUTING_TRACE_MAX_STEPS = 24;
export const ROUTING_TRACE_MAX_HEADER_CHARS = 3_500;
export const ROUTING_TRACE_MAX_ERROR_CHARS = 160;

export type RoutingTraceStep =
  | { kind: "combo"; name: string; strategy: string; models: string[] }
  | {
    kind: "smart";
    name: string;
    need: string;
    tier: string;
    reason?: string;
    score?: number;
    confidence?: number;
    degraded?: boolean;
    classifierModel?: string;
    classifierLatencyMs?: number;
    candidates: string[];
  }
  | { kind: "adapter"; requested: string; capabilities: string[]; models: string[]; strategy: string }
  | { kind: "attempt"; model: string; index: number; total: number; outcome: "ok" | "failed" | "aborted"; status?: number; error?: string }
  | { kind: "account"; provider: string; model: string; connection?: string; outcome: "selected" | "switched" | "exhausted" | "failed"; status?: number; error?: string };

export type RoutingTraceStepKind = RoutingTraceStep["kind"];

export interface RoutingTrace {
  requestedModel: string;
  steps: RoutingTraceStep[];
  selectedModel?: string;
  truncated?: boolean;
}

const STEP_KINDS = new Set<string>(["combo", "smart", "adapter", "attempt", "account"]);

/**
 * A compact summary of what routing did, small enough to store on every request.
 *
 * The full trace only ever rode the response header, which is ephemeral, and
 * `requestDetails` — the one table that could keep it — is opt-in and pruned by
 * `observabilityMaxRecords`. So with observability off, which is the default,
 * nothing durably recorded WHY a request went where it went. `usageHistory` is
 * always written, so this goes in its `meta` column (previously written as a
 * constant `{}`).
 *
 * Deliberately much smaller than the header trace: `usageHistory` is never
 * pruned and gains a row per request, so storing the full step list would trade
 * a dead column for a bloated table. Counts and outcomes, not the narrative.
 */
export interface RoutingTraceSummary {
  requested: string;
  selected?: string;
  /** Number of steps recorded, before any truncation. */
  steps: number;
  /** Accounts that failed or were switched away from before one answered. */
  switched?: number;
  /** Model-level attempts that failed. */
  failed?: number;
  combo?: string;
  tier?: string;
  truncated?: true;
}

export function summarizeRoutingTrace(trace: RoutingTrace | null | undefined): RoutingTraceSummary | null {
  if (!trace) return null;
  const summary: RoutingTraceSummary = {
    requested: trace.requestedModel,
    steps: trace.steps.length,
  };
  if (trace.selectedModel) summary.selected = trace.selectedModel;
  if (trace.truncated) summary.truncated = true;

  let switched = 0;
  let failed = 0;
  for (const step of trace.steps) {
    if (step.kind === "account" && (step.outcome === "switched" || step.outcome === "failed")) switched += 1;
    if (step.kind === "attempt" && step.outcome === "failed") failed += 1;
    if (step.kind === "combo" && !summary.combo) summary.combo = step.name;
    if (step.kind === "smart") {
      if (!summary.combo) summary.combo = step.name;
      if (!summary.tier) summary.tier = step.tier;
    }
  }
  if (switched > 0) summary.switched = switched;
  if (failed > 0) summary.failed = failed;
  return summary;
}

export function truncateTraceError(error: unknown): string | undefined {
  const text = typeof error === "string" ? error.trim() : error instanceof Error ? error.message.trim() : "";
  if (!text) return undefined;
  return text.length > ROUTING_TRACE_MAX_ERROR_CHARS
    ? `${text.slice(0, ROUTING_TRACE_MAX_ERROR_CHARS - 1)}…`
    : text;
}

// Header values are latin-1 by spec; provider errors are not. Escaping to \uXXXX
// keeps the payload valid JSON and safe to put on the wire unencoded.
function toAsciiJson(trace: RoutingTrace): string {
  return JSON.stringify(trace).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

// Upstream error text is the first thing to go: knowing *which* models were
// considered and tried outlives knowing the full wording of each failure.
function withShorterErrors(trace: RoutingTrace, limit: number): RoutingTrace {
  return {
    ...trace,
    steps: trace.steps.map((step) => {
      if (step.kind !== "attempt" && step.kind !== "account") return step;
      if (!step.error || step.error.length <= limit) return step;
      return { ...step, error: `${step.error.slice(0, limit - 1)}…` };
    }),
  };
}

// An emptied list must never look like an empty result: a reader seeing
// `candidates: []` would conclude routing found nothing, so this always flags
// the trace as truncated.
function withoutVerboseLists(trace: RoutingTrace): RoutingTrace {
  return {
    ...trace,
    truncated: true,
    steps: trace.steps.map((step) => {
      switch (step.kind) {
        case "combo":
          return { ...step, models: [] };
        case "smart":
          return { ...step, candidates: [], reason: step.reason };
        case "adapter":
          return { ...step, models: [] };
        case "attempt":
        case "account":
          return step;
        default: {
          const exhaustive: never = step;
          return exhaustive;
        }
      }
    }),
  };
}

// Attempts are the story of the request, so when space runs out drop from the
// middle and say so rather than silently keeping only the beginning.
function withFewerSteps(trace: RoutingTrace, keep: number): RoutingTrace {
  if (trace.steps.length <= keep) return trace;
  const head = Math.ceil(keep / 2);
  return {
    ...trace,
    steps: [...trace.steps.slice(0, head), ...trace.steps.slice(trace.steps.length - (keep - head))],
    truncated: true,
  };
}

export function serializeRoutingTrace(trace: RoutingTrace): string | null {
  if (!trace.requestedModel || trace.steps.length === 0) return null;

  const candidates = [
    trace,
    withShorterErrors(trace, 60),
    withoutVerboseLists(withShorterErrors(trace, 60)),
    withFewerSteps(withoutVerboseLists(withShorterErrors(trace, 60)), 8),
    withFewerSteps(withoutVerboseLists(withShorterErrors(trace, 60)), 4),
  ];
  for (const candidate of candidates) {
    const encoded = toAsciiJson(candidate);
    if (encoded.length <= ROUTING_TRACE_MAX_HEADER_CHARS) return encoded;
  }
  return toAsciiJson({
    requestedModel: trace.requestedModel,
    selectedModel: trace.selectedModel,
    steps: [],
    truncated: true,
  });
}

export function parseRoutingTrace(headerValue: string | null | undefined): RoutingTrace | null {
  if (!headerValue) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(headerValue);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.requestedModel !== "string" || !Array.isArray(candidate.steps)) return null;

  const steps = candidate.steps.filter((step): step is RoutingTraceStep =>
    Boolean(step) && typeof step === "object" && STEP_KINDS.has(String((step as Record<string, unknown>).kind)));

  return {
    requestedModel: candidate.requestedModel,
    steps,
    ...(typeof candidate.selectedModel === "string" ? { selectedModel: candidate.selectedModel } : {}),
    ...(candidate.truncated === true ? { truncated: true } : {}),
  };
}
