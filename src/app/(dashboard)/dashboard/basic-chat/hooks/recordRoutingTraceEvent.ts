import type { RoutingTrace } from "@/shared/observability/routingTrace";

export const ROUTING_TRACE_EVENT = "routing/trace";

type RecordEventFn = (sessionId: string, type: string, data: Record<string, unknown>) => void;

/**
 * Put the gateway's routing story in the run journal: which combo was resolved,
 * how smart routing decided, and every account it tried before answering. Kept
 * flat in `data` so the journal's raw JSON view stays readable.
 */
export function recordRoutingTraceEvent(
  recordHarnessEvent: RecordEventFn,
  sessionId: string,
  runId: string,
  trace: RoutingTrace | null | undefined,
): void {
  if (!trace) return;
  if (trace.steps.length === 0 && !trace.selectedModel) return;
  recordHarnessEvent(sessionId, ROUTING_TRACE_EVENT, {
    runId,
    requestedModel: trace.requestedModel,
    ...(trace.selectedModel ? { selectedModel: trace.selectedModel } : {}),
    ...(trace.truncated ? { truncated: true } : {}),
    steps: trace.steps,
  });
}
