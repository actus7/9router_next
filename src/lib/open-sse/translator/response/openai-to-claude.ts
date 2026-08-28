import { register } from "../index";
import { FORMATS } from "../formats";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from "../schema/index";
import { fromOpenAIFinish } from "../concerns/finishReason";
import { extractReasoningText } from "../concerns/reasoning";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName: string, argsJson: string) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
    return argsJson;
  }
}

function sanitizeReadArgs(args: Record<string, unknown>) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  const limit = args.limit;
  if (typeof limit === "number") {
    if (limit > 2000) args.limit = 2000;
    if (limit < 1) delete args.limit;
  }
  const offset = args.offset;
  if (typeof offset === "number" && offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path as string, args.pages as string)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath: unknown, pages: unknown) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}

// Helper: stop thinking block if started
function stopThinkingBlock(state: Record<string, unknown>, results: Record<string, unknown>[]) {
  if (!state.thinkingBlockStarted) return;
  results.push({
    type: "content_block_stop",
    index: state.thinkingBlockIndex
  });
  state.thinkingBlockStarted = false;
}

// Helper: stop text block if started
function stopTextBlock(state: Record<string, unknown>, results: Record<string, unknown>[]) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({
    type: "content_block_stop",
    index: state.textBlockIndex
  });
  state.textBlockStarted = false;
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk: Record<string, unknown>, state: Record<string, unknown>) {
  if (!chunk || !(chunk.choices as unknown[])?.[0]) return null;

  const results: Record<string, unknown>[] = [];
  const choice = (chunk.choices as Record<string, unknown>[])[0];
  const delta = choice.delta as Record<string, unknown> | undefined;

  // Track usage from OpenAI chunk if available
  if (chunk.usage && typeof chunk.usage === "object") {
    const usage = chunk.usage as Record<string, unknown>;
    const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;

    // Extract cache tokens from prompt_tokens_details
    const cachedTokens = details?.cached_tokens;
    const cacheCreationTokens = details?.cache_creation_tokens;
    const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
    const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;

    // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
    // Because OpenAI's prompt_tokens includes all prompt-side tokens
    const inputTokens = promptTokens - cacheReadTokens - cacheCreateTokens;

    state.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    };

    // Add cache_read_input_tokens if present
    if (cacheReadTokens > 0) {
      (state.usage as Record<string, unknown>).cache_read_input_tokens = cacheReadTokens;
    }

    // Add cache_creation_input_tokens if present
    if (cacheCreateTokens > 0) {
      (state.usage as Record<string, unknown>).cache_creation_input_tokens = cacheCreateTokens;
    }

    // Note: completion_tokens_details.reasoning_tokens is already included in output_tokens
    // No need to add separately as Claude expects total output_tokens
  }

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    const chunkId = chunk.id as string | undefined;
    state.messageId = chunkId?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    const msgId = state.messageId as string;
    if (!msgId || msgId === "chat" || msgId.length < 8) {
      const extFields = chunk.extend_fields as Record<string, unknown> | undefined;
      state.messageId = (extFields?.requestId as string) ||
        (extFields?.traceId as string) ||
        `msg_${Date.now()}`;
    }
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: ROLE.ASSISTANT,
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);

    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = (state.nextBlockIndex as number)++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  if (delta?.content) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      state.textBlockIndex = (state.nextBlockIndex as number)++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    const toolCalls = state.toolCalls as Map<number, Record<string, unknown>> | undefined;
    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      const idx = (tc.index as number) ?? 0;

      // GLM/fireworks repeats id+null-name on every arg chunk; open block once per idx
      if (tc.id && !toolCalls?.has(idx)) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);

        const toolBlockIndex = (state.nextBlockIndex as number)++;
        if (!state.toolCalls) state.toolCalls = new Map();
        (state.toolCalls as Map<number, Record<string, unknown>>).set(idx, { id: tc.id, name: (tc.function as Record<string, unknown>)?.name || "", blockIndex: toolBlockIndex });

        // Strip prefix from tool name for response
        let toolName = ((tc.function as Record<string, unknown>)?.name as string) || "";
        if (toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
          toolName = toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length);
        }

        results.push({
          type: "content_block_start",
          index: toolBlockIndex,
          content_block: {
            type: CLAUDE_BLOCK.TOOL_USE,
            id: tc.id,
            name: toolName,
            input: {}
          }
        });
      }

      if ((tc.function as Record<string, unknown>)?.arguments) {
        const toolInfo = (state.toolCalls as Map<number, Record<string, unknown>>)?.get(idx);
        if (toolInfo) {
          // Buffer args instead of streaming — sanitize at finish to fix bad params
          if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
          const buffers = state.toolArgBuffers as Map<number, string>;
          buffers.set(idx, (buffers.get(idx) || "") + ((tc.function as Record<string, unknown>).arguments as string));
        }
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    const toolCallsMap = state.toolCalls as Map<number, Record<string, unknown>> | undefined;
    if (toolCallsMap) {
      for (const [idx, toolInfo] of toolCallsMap) {
        // Emit buffered + sanitized args as single delta before stop
        const buffered = (state.toolArgBuffers as Map<number, string> | undefined)?.get(idx);
        if (buffered) {
          const sanitized = sanitizeToolArgs(toolInfo.name as string, buffered);
          results.push({
            type: "content_block_delta",
            index: toolInfo.blockIndex,
            delta: { type: "input_json_delta", partial_json: sanitized }
          });
        }
        results.push({
          type: "content_block_stop",
          index: toolInfo.blockIndex
        });
      }
    }

    // Mark finish for later usage injection in stream.js
    state.finishReason = choice.finish_reason;

    // Use tracked usage (will be estimated in stream.js if not valid)
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({
      type: "message_delta",
      delta: { stop_reason: convertFinishReason(choice.finish_reason as string) },
      usage: finalUsage
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

const convertFinishReason = (reason: string) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse as (chunk: unknown, state: unknown) => unknown);
