import { saveRequestUsage } from "@/lib/usageDb";
import { getRoutingTrace } from "@/server/llm-gateway/engine/services/routingTrace";
import { summarizeRoutingTrace } from "@/shared/observability/routingTrace";
import * as log from "../utils/logger";

interface FailedRequestInput {
  body: Record<string, unknown>;
  response: Response;
  requested: string;
  endpoint?: string;
  apiKey: string | null;
}

// A caller's own malformed or unauthorized request (400/401/403/404/422) is not a
// gateway outcome worth a never-pruned row; a loop of them would only grow the table.
function isRecordable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * A request whose every attempt failed leaves no token usage, and the usage
 * writer skips rows without tokens — so the Requests list never saw it. This
 * writes the row it would have had, with the routing summary, so the failure
 * (and which model failed how) is visible and filterable.
 */
export async function recordFailedRequest({ body, response, requested, endpoint, apiKey }: FailedRequestInput): Promise<void> {
  if (response.ok || !isRecordable(response.status)) return;
  try {
    const summary = summarizeRoutingTrace(getRoutingTrace(body));
    const lastProvider = summary?.attempts?.at(-1)?.provider;
    await saveRequestUsage({
      provider: lastProvider || undefined,
      model: requested,
      endpoint,
      apiKey: apiKey || undefined,
      status: "failed",
      tokens: {},
      meta: { ...(summary ? { routing: summary } : {}), httpStatus: response.status },
    });
  } catch (error) {
    // Accounting must never turn an upstream failure into a different failure.
    log.warn("CHAT", "could not record failed request", { error: error instanceof Error ? error.message : String(error) });
  }
}
