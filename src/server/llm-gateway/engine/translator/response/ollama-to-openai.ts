import { register } from "../index";
import { FORMATS } from "../formats";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from "../schema/index";
import { buildChunk } from "../concerns/chunk";
import { toOpenAIUsage } from "../concerns/usage";
import { fallbackToolCallId } from "../concerns/toolCall";
import { toOpenAIFinish } from "../concerns/finishReason";

/**
 * Convert Ollama NDJSON response to OpenAI SSE format
 *
 * Ollama response format:
 * {"model": "...", "message": {"role": "assistant", "content": "..."}, "done": false}
 * {"model": "...", "done": true, "prompt_eval_count": 123, "eval_count": 456}
 *
 * OpenAI format:
 * {"id": "...", "object": "chat.completion.chunk", "created": 123, "model": "...",
 *  "choices": [{"index": 0, "delta": {"content": "..."}, "finish_reason": null}]}
 */
export function ollamaToOpenAIResponse(chunk: Record<string, unknown>, state: Record<string, unknown>) {
  if (!chunk || typeof chunk !== "object") return null;

  // Initialize state on first chunk
  if (!state.ollama) {
    state.ollama = {
      id: `chatcmpl-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: chunk.model || state.model
    };
  }

  const ollama = state.ollama as Record<string, unknown>;
  const id = ollama.id as string;
  const created = ollama.created as number;
  const model = ollama.model as string;

  // Final chunk with done=true
  if (chunk.done) {
    const usage = extractUsage(chunk);
    
    // Determine finish_reason: map upstream done_reason, override to tool_calls if tools used
    let finishReason = toOpenAIFinish(chunk.done_reason as string | null | undefined, "ollama");
    if (chunk.done_reason === OPENAI_FINISH.TOOL_CALLS || state.hadToolCalls) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }

    const doneChunk = buildChunk({ id, created, model }, {}, finishReason);
    (doneChunk as Record<string, unknown>).usage = usage;
    return doneChunk;
  }

  // Content chunk
  const message = chunk.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const content = typeof message.content === "string" ? message.content : "";
  const thinking = typeof message.thinking === "string" ? message.thinking : "";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : null;

  // Skip empty chunks
  if (!content && !thinking && !toolCalls) return null;

  // Accumulate content in state
  if (content) {
    state.accumulatedContent = (state.accumulatedContent || "") + content;
  }
  if (thinking) {
    state.accumulatedThinking = (state.accumulatedThinking || "") + thinking;
  }

  const delta: Record<string, unknown> = {};
  if (content) delta.content = content;
  if (thinking) delta.reasoning_content = thinking;
  
  // Convert Ollama tool_calls to OpenAI format
  if (toolCalls) {
    state.hadToolCalls = true;
    delta.tool_calls = convertToolCalls(toolCalls);
  }

  return buildChunk({ id, created, model }, delta, null);
}

/**
 * Extract usage stats from Ollama response
 */
function extractUsage(ollamaChunk: Record<string, unknown>) {
  return toOpenAIUsage(ollamaChunk, "ollama");
}

/**
 * Convert tool_calls from Ollama format to OpenAI format
 */
function convertToolCalls(toolCalls: unknown[]) {
  return toolCalls.map((tc: unknown, i: number) => {
    const tool = tc as Record<string, unknown>;
    const fn = tool.function as Record<string, unknown> | undefined;
    return {
      index: fn?.index ?? i,
      id: (tool.id as string) || fallbackToolCallId(i),
      type: OPENAI_BLOCK.FUNCTION,
      function: {
        name: (fn?.name as string) || "",
        arguments: typeof fn?.arguments === "string"
          ? fn.arguments
          : JSON.stringify(fn?.arguments || {})
      }
    };
  });
}

/**
 * Convert Ollama non-streaming response body to OpenAI chat.completion format
 */
export function ollamaBodyToOpenAI(body: Record<string, unknown>) {
  const msg = (body.message || {}) as Record<string, unknown>;
  const content = (msg.content as string) || "";
  const thinking = (msg.thinking as string) || "";
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

  const message: Record<string, unknown> = { role: ROLE.ASSISTANT };
  if (content) message.content = content;
  if (thinking) message.reasoning_content = thinking;
  if (toolCalls.length > 0) message.tool_calls = convertToolCalls(toolCalls);
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = toOpenAIFinish(body.done_reason as string | null | undefined, "ollama");
  if (toolCalls.length > 0) finishReason = OPENAI_FINISH.TOOL_CALLS;

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: (body.model as string) || "ollama",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: extractUsage(body)
  };
}

// Register translator
register(FORMATS.OLLAMA, FORMATS.OPENAI, null, ollamaToOpenAIResponse as (chunk: unknown, state: unknown) => unknown);
