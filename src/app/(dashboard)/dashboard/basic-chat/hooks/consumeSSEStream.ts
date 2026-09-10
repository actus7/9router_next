import { textValue } from "../chatFormatUtils";
import { ROUTING_TRACE_HEADER, parseRoutingTrace, type RoutingTrace } from "@/shared/observability/routingTrace";
import { StreamChunkAccumulator, collectToolCallDeltas } from "@/shared/chat/streamChunk";
import type { TokenUsage, ToolCall } from "../types";

export { collectToolCallDeltas };

export interface ChatFetchResult {
  text: string;
  streamed: boolean;
  toolCalls: ToolCall[];
  reasoning: string;
  usage: TokenUsage | null;
  responseSource: "synapse" | null;
  routingTrace: RoutingTrace | null;
}

/** A failed request still carries the routing story, which is usually the reason it failed. */
export type ChatFetchError = Error & { status?: number; routingTrace?: RoutingTrace | null };

export function readRoutingTraceFromError(error: unknown): RoutingTrace | null {
  return (error as ChatFetchError | null)?.routingTrace || null;
}

/**
 * POST to the chat completions endpoint. If the response is a ReadableStream
 * the SSE chunks are consumed via `onStreamText`; otherwise the JSON body is
 * returned as a single fallback text.
 */
export async function executeChatFetch(
  url: string,
  fetchOptions: RequestInit,
  onStreamText: (text: string) => void,
): Promise<ChatFetchResult> {
  const response = await fetch(url, fetchOptions);
  const responseSource = response.headers.get("x-modelhub-response-source") === "synapse" ? "synapse" : null;
  const routingTrace = parseRoutingTrace(response.headers.get(ROUTING_TRACE_HEADER));

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const requestError = new Error(
      textValue(errorData.error || errorData.message || `Request failed (${response.status})`),
    ) as ChatFetchError;
    requestError.status = response.status;
    requestError.routingTrace = routingTrace;
    throw requestError;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const fallbackText = textValue(
      ((data?.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined)
        ?.message || data?.output_text || data?.error || data?.message || "",
    );
    return { text: fallbackText, streamed: false, toolCalls: [], reasoning: "", usage: null, responseSource, routingTrace };
  }

  const { text, toolCalls, reasoning, usage } = await consumeSSEStream(reader, onStreamText);
  return { text, streamed: true, toolCalls, reasoning, usage, responseSource, routingTrace };
}

/** Read an SSE stream, invoking `onText` with the accumulated text on every chunk. */
async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (text: string) => void,
): Promise<{ text: string; toolCalls: ToolCall[]; reasoning: string; usage: TokenUsage | null }> {
  const decoder = new TextDecoder();
  const accumulator = new StreamChunkAccumulator();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (accumulator.push(decoder.decode(value, { stream: true }))) {
      onText(accumulator.result().text);
    }
  }

  const parsed = accumulator.finish(decoder.decode());
  // A provider that closes right after its last frame, with no trailing
  // newline, only yields that frame here — the caller still has to see it.
  if (parsed.text) onText(parsed.text);
  return {
    text: parsed.text,
    toolCalls: parsed.toolCalls.map((call) => ({ ...call, status: "pending" as const })),
    reasoning: parsed.reasoning,
    usage: parsed.usage,
  };
}
