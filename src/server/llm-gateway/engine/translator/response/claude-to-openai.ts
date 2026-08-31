import { register } from "../registry";
import { FORMATS } from "../formats";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, OPENAI_FINISH } from "../schema/index";
import { buildChunk } from "../concerns/chunk";
import { toOpenAIUsage } from "../concerns/usage";
import { reasoningDelta } from "../concerns/reasoning";
import { toOpenAIFinish } from "../concerns/finishReason";

// File-local interfaces for Claude streaming chunk shapes
interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeContentBlock {
  type?: string;
  id?: string;
  name?: string;
}

interface ClaudeDelta {
  type?: string;
  text?: string;
  thinking?: string;
  partial_json?: string;
  stop_reason?: string;
}

interface ClaudeMessage {
  id?: string;
  model?: string;
  usage?: ClaudeUsage;
}

interface ClaudeChunk {
  type?: string;
  message?: ClaudeMessage;
  content_block?: ClaudeContentBlock;
  delta?: ClaudeDelta;
  usage?: ClaudeUsage;
  index?: number;
}

// Create OpenAI chunk helper
function createChunk(state: Record<string, unknown>, delta: Record<string, unknown>, finishReason: string | null = null) {
  return buildChunk(
    { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model as string },
    delta,
    finishReason
  );
}

// Convert Claude stream chunk to OpenAI format
export function claudeToOpenAIResponse(chunk: unknown, state: unknown) {
  if (!chunk) return null;

  const c = chunk as ClaudeChunk;
  const s = state as Record<string, unknown>;
  const results: Record<string, unknown>[] = [];
  const event = c.type;

  switch (event) {
    case "message_start": {
      s.messageId = c.message?.id || `msg_${Date.now()}`;
      s.model = c.message?.model;
      s.toolCallIndex = 0;
      // Claude sends input_tokens + cache_read + cache_creation here; message_delta
      // later carries only the final output_tokens. Capture cache now so the
      // delta (output-only) doesn't reset it to zero.
      const startUsage = c.message?.usage;
      if (startUsage && typeof startUsage === "object") {
        const inputTokens = typeof startUsage.input_tokens === "number" ? startUsage.input_tokens : 0;
        const cacheReadTokens = typeof startUsage.cache_read_input_tokens === "number" ? startUsage.cache_read_input_tokens : 0;
        const cacheCreationTokens = typeof startUsage.cache_creation_input_tokens === "number" ? startUsage.cache_creation_input_tokens : 0;
        const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
        s.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: 0,
          total_tokens: promptTokens,
          input_tokens: inputTokens,
          output_tokens: 0
        };
        if (cacheReadTokens > 0) (s.usage as Record<string, unknown>).cache_read_input_tokens = cacheReadTokens;
        if (cacheCreationTokens > 0) (s.usage as Record<string, unknown>).cache_creation_input_tokens = cacheCreationTokens;
      }
      results.push(createChunk(s, { role: ROLE.ASSISTANT }));
      break;
    }

    case "content_block_start": {
      const block = c.content_block;
      if (block?.type === "server_tool_use") {
        // Built-in tool (web search) - Claude handles internally, skip
        s.serverToolBlockIndex = c.index;
        break;
      }
      if (block?.type === CLAUDE_BLOCK.TEXT) {
        s.textBlockStarted = true;
      } else if (block?.type === CLAUDE_BLOCK.THINKING) {
        s.inThinkingBlock = true;
        s.currentBlockIndex = c.index;
        results.push(createChunk(s, { content: "<think>" }));
      } else if (block?.type === CLAUDE_BLOCK.TOOL_USE) {
        const toolCallIndex = s.toolCallIndex as number;
        s.toolCallIndex = toolCallIndex + 1;
        // Restore original tool name from mapping (Claude OAuth)
        const toolNameMap = s.toolNameMap as Map<string, string> | undefined;
        const toolName = toolNameMap?.get(block.name || "") || block.name;
        const toolCall = {
          index: toolCallIndex,
          id: block.id,
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: toolName,
            arguments: ""
          }
        };
        const toolCalls = s.toolCalls as Map<number, Record<string, unknown>>;
        toolCalls.set(c.index || 0, toolCall as Record<string, unknown>);
        results.push(createChunk(s, { tool_calls: [toolCall] }));
      }
      break;
    }

    case "content_block_delta": {
      // Skip deltas for built-in server tool blocks (web search)
      if (c.index === s.serverToolBlockIndex) break;
      const delta = c.delta;
      if (delta?.type === "text_delta" && delta.text) {
        results.push(createChunk(s, { content: delta.text }));
      } else if (delta?.type === "thinking_delta" && delta.thinking) {
        results.push(createChunk(s, reasoningDelta(delta.thinking)));
      } else if (delta?.type === "input_json_delta" && delta.partial_json) {
        const toolCalls = s.toolCalls as Map<number, Record<string, unknown>>;
        const toolCall = toolCalls.get(c.index || 0);
        if (toolCall) {
          (toolCall.function as Record<string, unknown>).arguments += delta.partial_json;
          results.push(createChunk(s, {
            tool_calls: [{
              index: toolCall.index,
              id: toolCall.id,
              function: { arguments: delta.partial_json }
            }]
          }));
        }
      }
      break;
    }

    case "content_block_stop": {
      // Skip stop for built-in server tool blocks (web search)
      if (c.index === s.serverToolBlockIndex) {
        s.serverToolBlockIndex = -1;
        break;
      }
      if (s.inThinkingBlock && c.index === s.currentBlockIndex) {
        results.push(createChunk(s, { content: "</think>" }));
        s.inThinkingBlock = false;
      }
      s.textBlockStarted = false;
      s.thinkingBlockStarted = false;
      break;
    }

    case "message_delta": {
      // Extract usage from message_delta event (Claude native format).
      // Anthropic sends input/cache in message_start and only output here, so
      // fall back to cache captured in message_start when the delta omits it.
      if (c.usage && typeof c.usage === "object") {
        const prev = (s.usage || {}) as Record<string, unknown>;
        const inputTokens = typeof c.usage!.input_tokens === "number" ? c.usage!.input_tokens : (typeof prev.input_tokens === "number" ? prev.input_tokens : 0);
        const outputTokens = typeof c.usage!.output_tokens === "number" ? c.usage!.output_tokens : 0;
        const cacheReadTokens = typeof c.usage!.cache_read_input_tokens === "number" ? c.usage!.cache_read_input_tokens : (typeof prev.cache_read_input_tokens === "number" ? prev.cache_read_input_tokens : 0);
        const cacheCreationTokens = typeof c.usage!.cache_creation_input_tokens === "number" ? c.usage!.cache_creation_input_tokens : (typeof prev.cache_creation_input_tokens === "number" ? prev.cache_creation_input_tokens : 0);

        // prompt_tokens = input_tokens + cache_read + cache_creation (all prompt-side tokens)
        const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;

        s.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: outputTokens,
          total_tokens: promptTokens + outputTokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens
        };

        if (cacheReadTokens > 0) (s.usage as Record<string, unknown>).cache_read_input_tokens = cacheReadTokens;
        if (cacheCreationTokens > 0) (s.usage as Record<string, unknown>).cache_creation_input_tokens = cacheCreationTokens;
      }

      if (c.delta?.stop_reason) {
        s.finishReason = convertStopReason(c.delta.stop_reason);
        const finalChunk = createChunk(s, {}, s.finishReason as string | null) as Record<string, unknown>;

        if (s.usage) {
          const usage = s.usage as Record<string, unknown>;
          // Build OpenAI usage from the merged state (cache from message_start +
          // output from message_delta), not the delta chunk alone.
          finalChunk.usage = toOpenAIUsage({
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
            cache_read_input_tokens: usage.cache_read_input_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens
          }, "claude");
        }

        results.push(finalChunk);
        s.finishReasonSent = true;
      }
      break;
    }

    case "message_stop": {
      if (!s.finishReasonSent) {
        const toolCallsMap = s.toolCalls as Map<number, Record<string, unknown>> | undefined;
        const finishReason = s.finishReason || (toolCallsMap && toolCallsMap.size > 0 ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP);
        const usageObj = (s.usage && typeof s.usage === 'object') ? {
          usage: {
            prompt_tokens: ((s.usage as Record<string, unknown>).input_tokens as number) || 0,
            completion_tokens: ((s.usage as Record<string, unknown>).output_tokens as number) || 0,
            total_tokens: (((s.usage as Record<string, unknown>).input_tokens as number) || 0) + (((s.usage as Record<string, unknown>).output_tokens as number) || 0)
          }
        } : {};
        results.push({ ...createChunk(s, {}, finishReason as string | null), ...usageObj });
        s.finishReasonSent = true;
      }
      break;
    }
  }

  return results.length > 0 ? results : null;
}

const convertStopReason = (reason: string | null | undefined) => toOpenAIFinish(reason, "claude");

// Register
register(FORMATS.CLAUDE, FORMATS.OPENAI, null, claudeToOpenAIResponse);

