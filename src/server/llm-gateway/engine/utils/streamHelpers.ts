import { FORMATS } from "../translator/formats";
import { fallbackToolCallId } from "../translator/concerns/toolCall";

// Parse SSE data line
export function parseSSELine(line: string, format: string | null = null) {
  if (!line) return null;

  // NDJSON format (Ollama): raw JSON lines without "data:" prefix
  if (format === FORMATS.OLLAMA) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed);
      } catch  {
        return null;
      }
    }
    return null;
  }

  // Standard SSE format: "data: {...}"
  if (line.charCodeAt(0) !== 100) return null; // 'd' = 100

  const data = line.slice(5).trim();
  if (data === "[DONE]") return { done: true };

  try {
    return JSON.parse(data);
  } catch  {
    if (data.length > 0 && data.length < 1000) {
      console.error(`[WARN] Failed to parse SSE line (${data.length} chars): ${data.substring(0, 100)}...`);
    }
    return null;
  }
}

// Check if chunk has valuable content (not empty)
export function hasValuableContent(chunk: Record<string, unknown>, format: string) {
  // OpenAI format
  const choices = chunk.choices as Array<{ delta: Record<string, unknown>; finish_reason?: string }> | undefined;
  if (format === FORMATS.OPENAI && choices?.[0]?.delta) {
    const delta = choices[0].delta;
    return delta.content && delta.content !== "" ||
           delta.reasoning_content && delta.reasoning_content !== "" ||
           delta.tool_calls && (delta.tool_calls as unknown[]).length > 0 ||
           choices[0].finish_reason ||
           delta.role;
  }

  // Claude format
  if (format === FORMATS.CLAUDE) {
    const isContentBlockDelta = chunk.type === "content_block_delta";
    const delta = chunk.delta as Record<string, unknown> | undefined;
    const hasText = delta?.text && delta.text !== "";
    const hasThinking = delta?.thinking && delta.thinking !== "";
    const hasInputJson = delta?.partial_json && delta.partial_json !== "";
    
    if (isContentBlockDelta && !hasText && !hasThinking && !hasInputJson) {
      return false;
    }
    return true;
  }

  return true; // Other formats: keep all chunks
}

/**
 * Make sure every streamed tool call carries an id when it opens.
 *
 * OpenAI's contract is that the id and name arrive on the FIRST fragment of a call and
 * later fragments carry only `index` + argument deltas. Some providers open a new
 * `index` in a late fragment and leave the id out, and strict OpenAI-compatible clients
 * (@ai-sdk/openai-compatible) then abort the whole turn: "Expected 'id' to be a string".
 *
 * `seen` remembers the id per index for the life of the stream. Only a fragment that
 * opens an index the client has not seen gets a minted id; a continuation is left as it
 * is, and so is a fragment with no index, which cannot be told apart from one.
 * Returns true when the chunk was changed.
 */
export function ensureStreamToolCallIds(chunk: Record<string, unknown>, seen: Map<unknown, string>): boolean {
  const choices = chunk?.choices;
  if (!Array.isArray(choices)) return false;
  let changed = false;
  for (const choice of choices) {
    const calls = (choice as { delta?: { tool_calls?: unknown } })?.delta?.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls as Array<Record<string, unknown> | null>) {
      if (!call || typeof call !== "object" || typeof call.index !== "number") continue;
      if (typeof call.id === "string" && call.id) { seen.set(call.index, call.id); continue; }
      if (seen.has(call.index)) continue;
      const id = fallbackToolCallId(call.index);
      call.id = id;
      seen.set(call.index, id);
      changed = true;
    }
  }
  return changed;
}

// Fix invalid id (generic or too short)
export function fixInvalidId(parsed: Record<string, unknown>) {
  if (parsed.id && (parsed.id === "chat" || parsed.id === "completion" || (parsed.id as string).length < 8)) {
    const extendFields = parsed.extend_fields as Record<string, unknown> | undefined;
    const fallbackId = extendFields?.requestId || 
                      extendFields?.traceId || 
                      Date.now().toString(36);
    parsed.id = `chatcmpl-${fallbackId}`;
    return true;
  }
  return false;
}

function cleanUsagePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  let cleaned = payload as Record<string, unknown>;

  if ("usage" in cleaned) {
    if (cleaned.usage === null) {
      const { usage, ...payloadWithoutUsage } = cleaned;
      cleaned = payloadWithoutUsage;
    } else if (typeof cleaned.usage === "object" && (cleaned.usage as Record<string, unknown>).perf_metrics === null) {
      const { perf_metrics, ...usageWithoutPerf } = cleaned.usage as Record<string, unknown>;
      cleaned = { ...cleaned, usage: usageWithoutPerf };
    }
  }

  if (cleaned.response && typeof cleaned.response === "object" && !Array.isArray(cleaned.response)) {
    const cleanedResponse = cleanUsagePayload(cleaned.response);
    if (cleanedResponse !== cleaned.response) {
      cleaned = { ...cleaned, response: cleanedResponse };
    }
  }

  return cleaned;
}

// Format output as SSE
export function formatSSE(data: unknown, sourceFormat: string) {
  if (data === null || data === undefined) return "data: null\n\n";
  const d = data as Record<string, unknown>;
  if (d && d.done) return "data: [DONE]\n\n";

  // OpenAI Responses API format
  if (d && d.event && d.data) {
    const cleanedEventData = cleanUsagePayload(d.data);
    return `event: ${d.event}\ndata: ${JSON.stringify(cleanedEventData)}\n\n`;
  }

  const cleaned = cleanUsagePayload(data) as Record<string, unknown>;

  // Claude format
  if (sourceFormat === FORMATS.CLAUDE && cleaned && cleaned.type) {
    return `event: ${cleaned.type}\ndata: ${JSON.stringify(cleaned)}\n\n`;
  }

  return `data: ${JSON.stringify(cleaned)}\n\n`;
}
