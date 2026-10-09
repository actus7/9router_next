// What the gateway did to answer one request: which combo was resolved, how
// smart routing decided, every model it tried and why each failed, and which
// account finally answered. Travels on a response header so the chat can show
// it even when persisted observability is off.

export const ROUTING_TRACE_HEADER = "X-ModelHub-Routing";

// A header is not a log: keep the value small enough that no proxy or runtime
// rejects the response, and drop detail before dropping the whole trace.
export const ROUTING_TRACE_MAX_STEPS = 48;
export const ROUTING_TRACE_MAX_HEADER_CHARS = 3_500;
export const ROUTING_TRACE_MAX_ERROR_CHARS = 160;
// The durable summary lives in a table that is never pruned, so it keeps less.
export const SUMMARY_MAX_ATTEMPTS = 12;
export const SUMMARY_MAX_ERROR_CHARS = 120;

export type AttemptOutcome = "ok" | "failed" | "aborted" | "cooldown_skip";
export type AttemptErrorClass =
  | "rate_limit" | "auth" | "billing" | "transient" | "timeout" | "client" | "cooldown" | "other";

const TIMEOUT_WORDING = /timeout|stalled|etimedout|timed out/i;

/** What kind of failure an attempt was, from the status and wording alone. */
export function classifyAttemptError(status: number | undefined, text: string | undefined): AttemptErrorClass {
  if (text && TIMEOUT_WORDING.test(text)) return "timeout";
  switch (status) {
    case 429: return "rate_limit";
    case 401: case 403: return "auth";
    case 402: return "billing";
    case 408: case 504: return "timeout";
    case 400: case 413: case 422: return "client";
    default: return status !== undefined && status >= 500 ? "transient" : "other";
  }
}

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
    classifierSource?: "jev" | "heuristic" | "llm";
    candidates: string[];
  }
  | { kind: "adapter"; requested: string; capabilities: string[]; models: string[]; strategy: string }
  | {
    kind: "attempt";
    model: string;
    index: number;
    total: number;
    outcome: AttemptOutcome;
    status?: number;
    error?: string;
    errorClass?: AttemptErrorClass;
    /** Milliseconds this attempt ran (for a stream: until the response started). */
    durationMs?: number;
    /** Milliseconds from the start of the combo loop to this attempt's dispatch. */
    startOffsetMs?: number;
  }
  | { kind: "account"; provider: string; model: string; connection?: string; outcome: "selected" | "switched" | "exhausted" | "failed"; status?: number; error?: string };

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
export interface RoutingAttemptSummary {
  model: string;
  provider?: string;
  connection?: string;
  outcome: AttemptOutcome;
  status?: number;
  errorClass?: AttemptErrorClass;
  error?: string;
  durationMs?: number;
  startOffsetMs?: number;
  /** The credential-free default answered because the model before it had no account left. */
  freeFallback?: true;
}

export interface RoutingTraceSummary {
  /** Every model/account tried, in order, including the one that answered. */
  attempts?: RoutingAttemptSummary[];
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

function providerOf(model: string): string | undefined {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : undefined;
}

function shorten(text: string | undefined, limit: number): string | undefined {
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

// A solo model rotating accounts has no combo loop, so its story is the
// account steps. A combo has one attempt per model, and an account that failed
// inside a model that then answered is part of the story too: without it a
// request that survived on its second account shows no trace of the first.
function attemptsFromTrace(trace: RoutingTrace): RoutingAttemptSummary[] {
  const accountRow = (account: Extract<RoutingTraceStep, { kind: "account" }>): RoutingAttemptSummary => compact({
    model: `${account.provider}/${account.model}`,
    provider: account.provider,
    connection: account.connection,
    outcome: (account.outcome === "selected" ? "ok" : "failed") as AttemptOutcome,
    status: account.status,
    errorClass: account.status !== undefined ? classifyAttemptError(account.status, account.error) : undefined,
    error: shorten(account.error, SUMMARY_MAX_ERROR_CHARS),
  });
  const hasCombo = trace.steps.some((step) => step.kind === "attempt");
  if (!hasCombo) {
    // An account answering after its provider ran dry is the free default.
    let exhausted = false;
    const rows: RoutingAttemptSummary[] = [];
    for (const step of trace.steps) {
      if (step.kind !== "account") continue;
      if (step.outcome === "exhausted") {
        exhausted = true;
        continue;
      }
      const row = accountRow(step);
      rows.push(exhausted && step.outcome === "selected" ? { ...row, freeFallback: true } : row);
    }
    return rows;
  }
  // A model whose combo attempt failed already says so; its account failures
  // would only repeat it.
  const answered = new Set(trace.steps.flatMap((s) => (s.kind === "attempt" && s.outcome === "ok" ? [s.model] : [])));
  const rows: RoutingAttemptSummary[] = [];
  // Account steps are recorded before the attempt step that closes them.
  let pending: Array<Extract<RoutingTraceStep, { kind: "account" }>> = [];
  for (const step of trace.steps) {
    if (step.kind === "account") {
      pending.push(step);
      continue;
    }
    if (step.kind !== "attempt") continue;
    for (const account of pending) {
      if ((account.outcome === "switched" || account.outcome === "failed") && answered.has(`${account.provider}/${account.model}`)) {
        rows.push(accountRow(account));
      }
    }
    // No account left, yet something answered: the free default, inside this attempt.
    const exhausted = pending.find((a) => a.outcome === "exhausted");
    const free = exhausted ? pending.find((a) => a.outcome === "selected") : undefined;
    const status = step.status ?? exhausted?.status;
    const error = step.error ?? exhausted?.error;
    rows.push(compact({
      model: step.model,
      provider: providerOf(step.model),
      outcome: step.outcome,
      status,
      errorClass: step.outcome === "failed" && status !== undefined ? classifyAttemptError(status, error) : step.errorClass,
      error: shorten(error, SUMMARY_MAX_ERROR_CHARS),
      durationMs: step.durationMs,
      startOffsetMs: step.startOffsetMs,
    }));
    if (free && step.outcome !== "ok") rows.push({ ...accountRow(free), freeFallback: true as const });
    pending = [];
  }
  return rows;
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

  const attempts = attemptsFromTrace(trace);
  // Only a story with more than one beat is worth the bytes.
  if (attempts.length > 1 || attempts.some((a) => a.outcome !== "ok")) {
    if (attempts.length > SUMMARY_MAX_ATTEMPTS) summary.truncated = true;
    summary.attempts = attempts.slice(0, SUMMARY_MAX_ATTEMPTS);
  }
  return summary;
}

// The error text now outlives the response (usageHistory is never pruned) and is
// shown in the dashboard, so credential-shaped strings an upstream echoes back are
// scrubbed first. Best effort: patterns, not a guarantee.
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk|pk|rk|key|tok|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}/gi,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, "[redacted]"), text);
}

export function truncateTraceError(error: unknown): string | undefined {
  const raw = typeof error === "string" ? error.trim() : error instanceof Error ? error.message.trim() : "";
  const text = redactSecrets(raw);
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
