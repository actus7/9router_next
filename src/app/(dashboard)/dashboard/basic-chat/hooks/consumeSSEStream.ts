import { readAssistantText, readReasoningText, readStreamUsage, textValue } from "../chatFormatUtils";
import type { TokenUsage, ToolCall } from "../types";

export interface ChatFetchResult {
  text: string;
  streamed: boolean;
  toolCalls: ToolCall[];
  reasoning: string;
  usage: TokenUsage | null;
  responseSource: "synapse" | null;
}

type PartialStreamToolCall = {
  id?: unknown;
  index?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};

type StreamToolCall = Pick<ToolCall, "id" | "name" | "arguments">;

/** Merge OpenAI-compatible incremental tool-call chunks into complete calls. */
export function collectToolCallDeltas(
  calls: Map<number, StreamToolCall>,
  deltas: unknown,
): void {
  if (!Array.isArray(deltas)) return;
  for (const delta of deltas as PartialStreamToolCall[]) {
    const index = typeof delta.index === "number" ? delta.index : 0;
    const previous = calls.get(index) || { id: "", name: "", arguments: "" };
    const next: StreamToolCall = {
      id: typeof delta.id === "string" ? delta.id : previous.id,
      name: typeof delta.function?.name === "string" ? delta.function.name : previous.name,
      arguments: previous.arguments + (typeof delta.function?.arguments === "string" ? delta.function.arguments : ""),
    };
    calls.set(index, next);
  }
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

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const requestError = new Error(
      textValue(errorData.error || errorData.message || `Request failed (${response.status})`),
    ) as Error & { status?: number };
    requestError.status = response.status;
    throw requestError;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const fallbackText = textValue(
      ((data?.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined)
        ?.message || data?.output_text || data?.error || data?.message || "",
    );
    return { text: fallbackText, streamed: false, toolCalls: [], reasoning: "", usage: null, responseSource };
  }

  const { text, toolCalls, reasoning, usage } = await consumeSSEStream(reader, onStreamText);
  return { text, streamed: true, toolCalls, reasoning, usage, responseSource };
}

/** Read an SSE stream, invoking `onText` with the accumulated text on every chunk. */
async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (text: string) => void,
): Promise<{ text: string; toolCalls: ToolCall[]; reasoning: string; usage: TokenUsage | null }> {
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";
  let reasoningText = "";
  let usage: TokenUsage | null = null;
  const streamedToolCalls = new Map<number, StreamToolCall>();
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    try {
      const chunk = JSON.parse(payload);
      const delta = (chunk?.choices?.[0]?.delta || {}) as Record<string, unknown>;
      collectToolCallDeltas(streamedToolCalls, delta.tool_calls);
      usage = readStreamUsage(chunk) || usage;
      const reasoningDelta = readReasoningText(chunk);
      if (reasoningDelta) reasoningText += reasoningDelta;
      const text = readAssistantText(chunk);
      if (!text) return;

      assistantText += text;
      onText(assistantText);
    } catch {
      // Ignore malformed chunks.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      consumeLine(line);
    }
  }

  // Some providers close immediately after the final data frame instead of
  // terminating it with a newline. Flush the decoder and process that valid
  // final frame so the answer is not silently truncated.
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);

  return {
    text: assistantText,
    toolCalls: Array.from(streamedToolCalls.values())
      .filter((call) => call.id && call.name)
      .map((call) => ({ ...call, status: "pending" })),
    reasoning: reasoningText,
    usage,
  };
}
