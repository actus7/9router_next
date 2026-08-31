/**
 * Kiro → Claude Response Translator (DIRECT route, no OpenAI pivot)
 *
 * IMPORTANT: This translator does NOT receive raw Kiro AWS-EventStream frames.
 * KiroExecutor.transformEventStreamToSSE() (open-sse/executors/kiro.js) already
 * parses the binary EventStream and emits OpenAI-shaped
 * `chat.completion.chunk` objects. So the chunks arriving here are OpenAI
 * streaming chunks, and our job is OpenAI-chunk → Claude SSE events — the same
 * transformation openai-to-claude.js performs. We re-implement it here so the
 * direct `kiro:claude` route is self-contained and lossless (reasoning_content
 * → thinking blocks, tool_calls → tool_use blocks, usage → message_delta).
 *
 * Registered on the direct route by ../index.js; reached only when source
 * format is Claude and target is Kiro.
 */
import { register } from "../registry";
import { FORMATS } from "../formats";

function stopThinkingBlock(state: Record<string, unknown>, results: Record<string, unknown>[]) {
  if (!state.thinkingBlockStarted) return;
  results.push({ type: "content_block_stop", index: state.thinkingBlockIndex });
  state.thinkingBlockStarted = false;
}

function stopTextBlock(state: Record<string, unknown>, results: Record<string, unknown>[]) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({ type: "content_block_stop", index: state.textBlockIndex });
  state.textBlockStarted = false;
}

function convertFinishReason(reason: string) {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    default:
      return "end_turn";
  }
}

/**
 * Convert one OpenAI-format chunk (from KiroExecutor) into Claude SSE events.
 * Returns an array of Claude events, or null when the chunk yields nothing.
 */
function kiroToClaudeResponse(chunk: Record<string, unknown> | string, state: Record<string, unknown>) {
  // KiroExecutor emits chat.completion.chunk objects; tolerate string chunks
  // by attempting a parse (defensive — the direct path is always objects).
  let data: Record<string, unknown> | string = chunk;
  if (typeof chunk === "string") {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === "[DONE]") return null;
    try {
      data = JSON.parse(trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed);
    } catch {
      return null;
    }
  }

  if (typeof data === "string") return null;
  if (!data || !(data.choices as unknown[])?.[0]) return null;

  const results: Record<string, unknown>[] = [];
  const choice = (data.choices as Record<string, unknown>[])[0];
  const delta = (choice.delta as Record<string, unknown>) || {};

  // Track usage if present on the chunk.
  if (data.usage && typeof data.usage === "object") {
    const usage = data.usage as Record<string, unknown>;
    const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    const promptTokens =
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    const outputTokens =
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : 0;
    state.usage = { input_tokens: promptTokens, output_tokens: outputTokens };
    // Claude clients read cache_read/cache_creation to price a turn and to size
    // their prompt cache. Both spellings are accepted because the Kiro executor
    // emits the Chat shape and passthrough responses use the nested details form.
    const cacheRead = usage.cache_read_input_tokens
      ?? details?.cached_tokens;
    const cacheCreation = usage.cache_creation_input_tokens
      ?? details?.cache_creation_tokens;
    if (typeof cacheRead === "number") (state.usage as Record<string, unknown>).cache_read_input_tokens = cacheRead;
    if (typeof cacheCreation === "number") (state.usage as Record<string, unknown>).cache_creation_input_tokens = cacheCreation;
  }

  // First chunk → emit message_start.
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId =
      (typeof data.id === "string" && data.id.replace("chatcmpl-", "")) ||
      `msg_${Date.now()}`;
    state.model = data.model || "kiro";
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  // Reasoning / thinking content (Kiro reasoningContentEvent → reasoning_content).
  const reasoningContent = delta.reasoning_content || delta.reasoning;
  if (reasoningContent) {
    stopTextBlock(state, results);
    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = (state.nextBlockIndex as number)++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: "thinking", thinking: "" },
      });
    }
    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent },
    });
  }

  // Regular text content.
  if (delta.content) {
    stopThinkingBlock(state, results);
    if (!state.textBlockStarted) {
      state.textBlockIndex = (state.nextBlockIndex as number)++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: "text", text: "" },
      });
    }
    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content },
    });
  }

  // Tool calls.
  if (delta.tool_calls) {
    if (!state.toolCalls) state.toolCalls = new Map();
    if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
    const toolCallsMap = state.toolCalls as Map<number, Record<string, unknown>>;
    const toolArgBuffers = state.toolArgBuffers as Map<number, string>;
    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      const idx = (tc.index as number) ?? 0;
      if (tc.id) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);
        const toolBlockIndex = (state.nextBlockIndex as number)++;
        toolCallsMap.set(idx, {
          id: tc.id,
          name: (tc.function as Record<string, unknown>)?.name || "",
          blockIndex: toolBlockIndex,
        });
        results.push({
          type: "content_block_start",
          index: toolBlockIndex,
          content_block: {
            type: "tool_use",
            id: tc.id,
            name: (tc.function as Record<string, unknown>)?.name || "",
            input: {},
          },
        });
      }
      if ((tc.function as Record<string, unknown>)?.arguments) {
        const toolInfo = toolCallsMap.get(idx);
        if (toolInfo) {
          toolArgBuffers.set(
            idx,
            (toolArgBuffers.get(idx) || "") + ((tc.function as Record<string, unknown>).arguments as string)
          );
        }
      }
    }
  }

  // Finish.
  if (choice.finish_reason) {
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    const toolCallsMap = state.toolCalls as Map<number, Record<string, unknown>> | undefined;
    if (toolCallsMap) {
      const toolArgBuffers = state.toolArgBuffers as Map<number, string> | undefined;
      for (const [idx, toolInfo] of toolCallsMap) {
        const buffered = toolArgBuffers?.get(idx);
        if (buffered) {
          results.push({
            type: "content_block_delta",
            index: toolInfo.blockIndex,
            delta: { type: "input_json_delta", partial_json: buffered },
          });
        }
        results.push({ type: "content_block_stop", index: toolInfo.blockIndex });
      }
    }

    state.finishReason = choice.finish_reason;
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({
      type: "message_delta",
      delta: { stop_reason: convertFinishReason(choice.finish_reason as string) },
      usage: finalUsage,
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

/**
 * Non-streaming Kiro → Claude. KiroExecutor only produces a stream, so this is
 * a defensive helper for any non-streaming caller that hands us an aggregated
 * OpenAI-shaped completion.
 */
function kiroToClaudeNonStreaming(data: Record<string, unknown>) {
  const content: Record<string, unknown>[] = [];
  const choices = data?.choices as Record<string, unknown>[] | undefined;
  const choice = choices?.[0];
  const message = ((choice as Record<string, unknown>)?.message || {}) as Record<string, unknown>;

  if (message.content) {
    content.push({ type: "text", text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls as Record<string, unknown>[]) {
      let input: Record<string, unknown> = {};
      try {
        const fn = tc.function as Record<string, unknown> | undefined;
        input =
          typeof fn?.arguments === "string"
            ? JSON.parse(fn.arguments)
            : (fn?.arguments as Record<string, unknown>) || {};
      } catch {
        input = {};
      }
      content.push({
        type: "tool_use",
        id: (tc.id as string) || `toolu_${Date.now()}`,
        name: ((tc.function as Record<string, unknown>)?.name as string) || "",
        input,
      });
    }
  }

  const usage = (data?.usage || {}) as Record<string, unknown>;
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model: (data?.model as string) || "kiro",
    stop_reason: convertFinishReason(((choice as Record<string, unknown>)?.finish_reason as string) || "stop"),
    usage: {
      input_tokens: (usage.prompt_tokens as number) || 0,
      output_tokens: (usage.completion_tokens as number) || 0,
      // Same cache preservation as the streaming path above.
      ...(typeof ((usage.cache_read_input_tokens as number) ?? details?.cached_tokens) === "number"
        ? { cache_read_input_tokens: (usage.cache_read_input_tokens as number) ?? details?.cached_tokens }
        : {}),
      ...(typeof ((usage.cache_creation_input_tokens as number) ?? details?.cache_creation_tokens) === "number"
        ? { cache_creation_input_tokens: (usage.cache_creation_input_tokens as number) ?? details?.cache_creation_tokens }
        : {}),
    },
  };
}

register(FORMATS.KIRO, FORMATS.CLAUDE, null, kiroToClaudeResponse as (chunk: unknown, state: unknown) => unknown);
