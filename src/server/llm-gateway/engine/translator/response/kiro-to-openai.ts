/**
 * Kiro to OpenAI Response Translator
 * Converts Kiro/AWS CodeWhisperer streaming events to OpenAI SSE format
 */
import { register } from "../registry";
import { FORMATS } from "../formats";
import { ROLE, OPENAI_BLOCK } from "../schema/index";
import { buildChunk } from "../concerns/chunk";
import { toOpenAIUsage } from "../concerns/usage";
import { fallbackToolCallId } from "../concerns/toolCall";
import { reasoningDelta } from "../concerns/reasoning";
import { toOpenAIFinish } from "../concerns/finishReason";

// Build chunk meta for current kiro state
function chunkMeta(state: Record<string, unknown>) {
  return { id: state.responseId as string, created: state.created as number, model: (state.model as string) || "kiro" };
}

/**
 * Parse Kiro SSE event and convert to OpenAI format
 * Kiro events: assistantResponseEvent, codeEvent, supplementaryWebLinksEvent, etc.
 */
function kiroToOpenAIResponse(chunk: Record<string, unknown> | string, state: Record<string, unknown>) {
  
  if (!chunk) return null;

  // If chunk is already in OpenAI format (from executor transform), return as-is
  if (typeof chunk !== "string" && chunk.object === "chat.completion.chunk" && chunk.choices) {
    return chunk;
  }
  
  // Handle string chunk (raw SSE data)
  let data: Record<string, unknown>;
  if (typeof chunk === "string") {
    // Parse SSE format: event:xxx\ndata:xxx
    const lines = chunk.split("\n");
    let eventType = "";
    let eventData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith(":event-type:")) {
        eventType = line.slice(12).trim();
      } else if (line.startsWith("data:")) {
        eventData = line.slice(5).trim();
      } else if (line.startsWith(":content-type:")) {
        // Skip content-type header
      } else if (line.trim() && !line.startsWith(":")) {
        // Raw JSON data
        eventData = line.trim();
      }
    }

    if (!eventData) return null;

    try {
      data = JSON.parse(eventData);
      data._eventType = eventType;
    } catch {
      // Not JSON, might be raw text
      data = { text: eventData, _eventType: eventType };
    }
  } else {
    data = chunk;
  }

  // Initialize state if needed
  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.chunkIndex = 0;
  }

  const eventType = (data._eventType || data.event || "") as string;

  // Handle different Kiro event types
  if (eventType === "assistantResponseEvent" || data.assistantResponseEvent) {
    const evtData = (data.assistantResponseEvent || data) as Record<string, unknown>;
    const content = (evtData.content as string) || (data.content as string) || "";
    if (!content) return null;

    const openaiChunk = buildChunk(chunkMeta(state), {
      ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
      content: content
    }, null);

    state.chunkIndex = (state.chunkIndex as number) + 1;
    return openaiChunk;
  }

  // Handle reasoning/thinking events.
  // Kiro emits reasoningContentEvent when the request enabled thinking via
  // the <thinking_mode>enabled</thinking_mode> system-prompt tag. We surface
  // this as OpenAI delta.reasoning_content so downstream translators can map
  // it to Claude thinking blocks / Anthropic reasoning / etc.
  if (eventType === "reasoningContentEvent" || data.reasoningContentEvent) {
    const reasoning = data.reasoningContentEvent || data;
    const content = (typeof reasoning === "string")
      ? reasoning
      : ((reasoning as Record<string, unknown>).text || (reasoning as Record<string, unknown>).content || data.content || "") as string;
    if (!content) return null;

    const openaiChunk = buildChunk(chunkMeta(state), reasoningDelta(content, state.chunkIndex === 0), null);

    state.chunkIndex = (state.chunkIndex as number) + 1;
    return openaiChunk;
  }

  // Handle tool use events
  if (eventType === "toolUseEvent" || data.toolUseEvent) {
    state.hadToolUse = true;
    const toolUse = (data.toolUseEvent || data) as Record<string, unknown>;
    const toolCallId = (toolUse.toolUseId as string) || fallbackToolCallId();
    const toolName = (toolUse.name as string) || "";
    const toolInput = toolUse.input || {};

    const openaiChunk = buildChunk(chunkMeta(state), {
      ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
      tool_calls: [{
        index: 0,
        id: toolCallId,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: toolName,
          arguments: JSON.stringify(toolInput)
        }
      }]
    }, null);

    state.chunkIndex = (state.chunkIndex as number) + 1;
    return openaiChunk;
  }

  // Handle completion/done events
  if (eventType === "messageStopEvent" || eventType === "done" || data.messageStopEvent) {
    // tool_calls when a tool was used this turn, else stop (kiro upstream has no explicit reason)
    const finishReason = toOpenAIFinish(state.hadToolUse ? "tool_use" : "stop", "kiro");
    state.finishReason = finishReason; // Mark for usage injection in stream.js

    const openaiChunk = buildChunk(chunkMeta(state), {}, finishReason);

    // Include usage in final chunk if available
    if (state.usage && typeof state.usage === "object") {
      (openaiChunk as Record<string, unknown>).usage = state.usage;
    }

    return openaiChunk;
  }

// Handle usage events
  if (eventType === "usageEvent" || data.usageEvent) {
    const usage = toOpenAIUsage((data.usageEvent || data) as Record<string, unknown>, "kiro");
    if (usage) state.usage = usage;
    return null;
  }

  // Unknown event type - skip
  return null;
}

// Register translator
register(FORMATS.KIRO, FORMATS.OPENAI, null, kiroToOpenAIResponse as (chunk: unknown, state: unknown) => unknown);
