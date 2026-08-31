/**
 * CommandCode → OpenAI response translator
 *
 * CommandCode upstream emits NDJSON-style AI SDK v5 stream events:
 *   {"type":"start"} {"type":"start-step", ...}
 *   {"type":"reasoning-start","id":"..."} {"type":"reasoning-delta","text":"..."}
 *   {"type":"text-start","id":"..."}     {"type":"text-delta","text":"..."}
 *   {"type":"tool-input-start","id","toolName"}
 *   {"type":"tool-input-delta","id","delta"}
 *   {"type":"tool-input-end","id"}
 *   {"type":"tool-call","toolCallId","toolName","input"}
 *   {"type":"finish-step","finishReason","usage": {...}, ...}
 *   {"type":"finish",...}
 *
 * Each upstream "event" arrives as one JSON object per line — we receive it as a string chunk
 * already split per line by the upstream SSE/JSON-line reader in modelhub.
 */
import { register } from "../registry";
import { FORMATS } from "../formats";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from "../schema/index";
import { buildChunk } from "../concerns/chunk";
import { toOpenAIUsage } from "../concerns/usage";
import { reasoningDelta } from "../concerns/reasoning";
import { fallbackToolCallId } from "../concerns/toolCall";
import { toOpenAIFinish } from "../concerns/finishReason";

function ensureState(state: Record<string, unknown>, model: string) {
  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.model = state.model || model || "commandcode";
    state.chunkIndex = 0;
    state.toolIndex = 0;
    state.toolIndexById = new Map();
    state.openTools = new Set();
    state.openText = false;
    state.finishReason = null;
    state.usage = null;
  }
}

function makeChunk(state: Record<string, unknown>, delta: Record<string, unknown>, finishReason: string | null = null) {
  return buildChunk(
    { id: state.responseId as string, created: state.created as number, model: state.model as string },
    delta,
    finishReason
  );
}

const mapFinishReason = (reason: string) => toOpenAIFinish(reason, "commandcode");

export function commandCodeToOpenAIResponse(chunk: Record<string, unknown> | string, state: Record<string, unknown>) {
  if (!chunk) return null;

  // Already-OpenAI chunk: pass through
  if (chunk && typeof chunk === "object" && chunk.object === "chat.completion.chunk") {
    return chunk;
  }

  // Parse string lines coming out of upstream
  let event: Record<string, unknown> | string = chunk;
  if (typeof chunk === "string") {
    const line = chunk.trim();
    if (!line) return null;
    // Tolerate raw "data: {...}" framing if the upstream wrapper inserts it
    const json = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!json || json === "[DONE]") return null;
    try {
      event = JSON.parse(json);
    } catch {
      return null;
    }
  }

  if (!event || typeof event !== "object" || !event.type) return null;

  ensureState(state, event.model as string);
  const out: Record<string, unknown>[] = [];

  switch (event.type) {
    case "text-delta": {
      const text = (event.text as string) || (event.delta as string) || "";
      if (!text) break;
      const delta: Record<string, unknown> = state.chunkIndex === 0 ? { role: ROLE.ASSISTANT, content: text } : { content: text };
      state.chunkIndex = (state.chunkIndex as number) + 1;
      state.openText = true;
      out.push(makeChunk(state, delta));
      break;
    }
    case "reasoning-delta": {
      const text = (event.text as string) || "";
      if (!text) break;
      // Map reasoning to OpenAI "reasoning_content" field (used by deepseek-reasoner-style clients).
      const delta = reasoningDelta(text, state.chunkIndex === 0);
      state.chunkIndex = (state.chunkIndex as number) + 1;
      out.push(makeChunk(state, delta));
      break;
    }
    case "tool-input-start": {
      const id = (event.id as string) || (event.toolCallId as string) || fallbackToolCallId(state.toolIndex as number | undefined);
      const toolIndexById = state.toolIndexById as Map<string, number>;
      let idx = toolIndexById.get(id);
      if (idx == null) {
        idx = state.toolIndex as number;
        state.toolIndex = (state.toolIndex as number) + 1;
        toolIndexById.set(id, idx);
      }
      (state.openTools as Set<string>).add(id);
      const delta: Record<string, unknown> = {
        ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
        tool_calls: [{
          index: idx,
          id,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: (event.toolName as string) || "", arguments: "" },
        }],
      };
      state.chunkIndex = (state.chunkIndex as number) + 1;
      out.push(makeChunk(state, delta));
      break;
    }
    case "tool-input-delta": {
      const id = (event.id as string) || (event.toolCallId as string);
      const idx = (state.toolIndexById as Map<string, number>).get(id);
      if (idx == null) break;
      const delta: Record<string, unknown> = {
        tool_calls: [{
          index: idx,
          function: { arguments: (event.delta as string) || (event.inputTextDelta as string) || "" },
        }],
      };
      out.push(makeChunk(state, delta));
      break;
    }
    case "tool-call": {
      // Final consolidated tool call — only emit if we never saw tool-input-* deltas.
      const id = event.toolCallId as string;
      if ((state.toolIndexById as Map<string, number>).has(id)) break;
      const idx = state.toolIndex as number;
      state.toolIndex = (state.toolIndex as number) + 1;
      (state.toolIndexById as Map<string, number>).set(id, idx);
      const argsStr = typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {});
      const delta: Record<string, unknown> = {
        ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
        tool_calls: [{
          index: idx,
          id,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: (event.toolName as string) || "", arguments: argsStr },
        }],
      };
      state.chunkIndex = (state.chunkIndex as number) + 1;
      out.push(makeChunk(state, delta));
      break;
    }
    case "finish-step": {
      state.finishReason = mapFinishReason(event.finishReason as string);
      if (event.usage) state.usage = event.usage;
      break;
    }
    case "finish": {
      const finishReason = (state.finishReason as string | null) || mapFinishReason((event.finishReason as string) || "stop");
      const finalChunk = makeChunk(state, {}, finishReason);
      const totalUsage = event.totalUsage || state.usage;
      const usage = toOpenAIUsage(totalUsage as Record<string, unknown>, "commandcode");
      if (usage) (finalChunk as Record<string, unknown>).usage = usage;
      out.push(finalChunk);
      break;
    }
    case "error": {
      state.finishReason = OPENAI_FINISH.STOP;
      const errVal = event.error ?? event.message ?? "unknown";
      const errStr = typeof errVal === "string" ? errVal : JSON.stringify(errVal);
      out.push(makeChunk(state, { content: `\n\n[CommandCode error: ${errStr}]` }));
      out.push(makeChunk(state, {}, OPENAI_FINISH.STOP as string));
      break;
    }
    // Silently ignore: start, start-step, reasoning-start, reasoning-end, text-start, text-end,
    // provider-metadata, message-metadata, etc. They carry no client-visible content.
    default:
      break;
  }

  return out.length ? out : null;
}

register(FORMATS.COMMANDCODE, FORMATS.OPENAI, null, commandCodeToOpenAIResponse as (chunk: unknown, state: unknown) => unknown);
