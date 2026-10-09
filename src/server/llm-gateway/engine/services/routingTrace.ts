import {
  ROUTING_TRACE_HEADER,
  ROUTING_TRACE_MAX_STEPS,
  serializeRoutingTrace,
  type RoutingTrace,
  type RoutingTraceStep,
} from "../host/routingTrace";

// Rides on the request body like the smart-routing decision does: every routing
// layer already receives the same body object, so no request-scoped storage or
// threading through a dozen signatures is needed.
const ROUTING_TRACE = Symbol.for("routerx.routing.trace");

type TraceBody = Record<string | symbol, unknown>;

export function startRoutingTrace<T extends Record<string, unknown>>(body: T, requestedModel: string): T {
  (body as TraceBody)[ROUTING_TRACE] = { requestedModel, steps: [] } satisfies RoutingTrace;
  return body;
}

export function getRoutingTrace(body: Record<string, unknown> | null | undefined): RoutingTrace | null {
  if (!body) return null;
  return ((body as TraceBody)[ROUTING_TRACE] as RoutingTrace | undefined) || null;
}

export function recordRoutingStep(body: Record<string, unknown> | null | undefined, step: RoutingTraceStep): void {
  const trace = getRoutingTrace(body);
  if (!trace) return;
  if (trace.steps.length >= ROUTING_TRACE_MAX_STEPS) {
    trace.truncated = true;
    return;
  }
  trace.steps.push(step);
}

export function setRoutingTraceSelection(body: Record<string, unknown> | null | undefined, model: string): void {
  const trace = getRoutingTrace(body);
  if (trace) trace.selectedModel = model;
}

// Responses are built deep in the engine (SSE bodies included), so the header is
// attached by rewrapping the finished response instead of touching every builder.
export function withRoutingTraceHeader(response: Response, body: Record<string, unknown> | null | undefined): Response {
  const trace = getRoutingTrace(body);
  if (!trace) return response;
  const encoded = serializeRoutingTrace(trace);
  if (!encoded) return response;

  const headers = new Headers(response.headers);
  headers.set(ROUTING_TRACE_HEADER, encoded);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The free default answers from inside the attempt of the model that ran out of
// accounts, so to the combo that attempt looks like a success. Marking the
// response (not the body, which the capacity adapter may copy) lets the combo
// tell the two apart.
const FREE_FALLBACK_RESPONSES = new WeakSet<Response>();

export function markFreeFallback(response: Response): Response {
  FREE_FALLBACK_RESPONSES.add(response);
  return response;
}

export function isFreeFallback(response: Response): boolean {
  return FREE_FALLBACK_RESPONSES.has(response);
}
