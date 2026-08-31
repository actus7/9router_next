/**
 * Translator: OpenAI Chat Completions → OpenAI Responses API (response)
 * Converts streaming chunks from Chat Completions to Responses API events
 */
import { register } from "../registry";
import { FORMATS } from "../formats";
import { buildChunk } from "../concerns/chunk";
import { buildUsage } from "../concerns/usage";
import { fallbackToolCallId } from "../concerns/toolCall";
import { reasoningDelta, extractReasoningText } from "../concerns/reasoning";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM, OPENAI_FINISH, MODEL_FALLBACK } from "../schema/index";

type EmitFn = (eventType: string, data: Record<string, unknown>) => void;

/**
 * Translate OpenAI chunk to Responses API events
 * @returns {Array} Array of events with { event, data } structure
 */
function openaiToOpenAIResponsesResponse(chunk: unknown, state: unknown) {
  if (!chunk) {
    return flushEvents(state as Record<string, unknown>);
  }

  const c = chunk as Record<string, unknown>;
  const s = state as Record<string, unknown>;

  if (!(c.choices as unknown[])?.length) return [];

  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const nextSeq = () => ++(s.seq as number);

  const emit: EmitFn = (eventType, data) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  const choice = (c.choices as Record<string, unknown>[])[0];
  const idx = (choice.index as number) || 0;
  const delta = (choice.delta as Record<string, unknown>) || {};

  // Emit initial events
  if (!s.started) {
    s.started = true;
    s.responseId = c.id ? `resp_${c.id}` : s.responseId;

    emit("response.created", {
      type: "response.created",
      response: {
        id: s.responseId,
        object: "response",
        created_at: s.created,
        status: "in_progress",
        background: false,
        error: null,
        output: []
      }
    });

    emit("response.in_progress", {
      type: "response.in_progress",
      response: {
        id: s.responseId,
        object: "response",
        created_at: s.created,
        status: "in_progress"
      }
    });
  }

  // Handle reasoning across vendor shapes (reasoning_content / reasoning / reasoning_details)
  const reasoningText = extractReasoningText(delta);
  if (reasoningText) {
    startReasoning(s, emit, idx);
    emitReasoningDelta(s, emit, reasoningText);
  }

  // Handle text content
  if (delta.content) {
    let content = delta.content as string;

    if (content.includes("<think>")) {
      s.inThinking = true;
      content = content.replace("<think>", "");
      startReasoning(s, emit, idx);
    }

    if (content.includes("</think>")) {
      const parts = content.split("</think>");
      const thinkPart = parts[0];
      const textPart = parts.slice(1).join("</think>");
      if (thinkPart) emitReasoningDelta(s, emit, thinkPart);
      closeReasoning(s, emit);
      s.inThinking = false;
      content = textPart;
    }

    if (s.inThinking && content) {
      emitReasoningDelta(s, emit, content);
      return events;
    }

    if (content) {
      emitTextContent(s, emit, idx, content);
    }
  }

  // Handle tool_calls (empty array is truthy; require a real call)
  if (delta.tool_calls && (delta.tool_calls as unknown[]).length) {
    closeMessage(s, emit, idx);
    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      emitToolCall(s, emit, tc);
    }
  }

  // Handle finish_reason
  if (choice.finish_reason) {
    for (const i in s.msgItemAdded as Record<string, unknown>) closeMessage(s, emit, i);
    closeReasoning(s, emit);
    for (const i in s.funcCallIds as Record<string, unknown>) closeToolCall(s, emit, i);
    sendCompleted(s, emit);
  }

  return events;
}

// Helper functions
function startReasoning(state: Record<string, unknown>, emit: EmitFn, idx: number) {
  if (!state.reasoningId) {
    state.reasoningId = `rs_${state.responseId}_${idx}`;
    state.reasoningIndex = idx;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: state.reasoningId, type: RESPONSES_ITEM.REASONING, summary: [] }
    });

    emit("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: state.reasoningId,
      output_index: idx,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: "" }
    });
    state.reasoningPartAdded = true;
  }
}

function emitReasoningDelta(state: Record<string, unknown>, emit: EmitFn, text: string) {
  if (!text) return;
  state.reasoningBuf = (state.reasoningBuf as string || "") + text;
  emit("response.reasoning_summary_text.delta", {
    type: "response.reasoning_summary_text.delta",
    item_id: state.reasoningId,
    output_index: state.reasoningIndex,
    summary_index: 0,
    delta: text
  });
}

function closeReasoning(state: Record<string, unknown>, emit: EmitFn) {
  if (state.reasoningId && !state.reasoningDone) {
    state.reasoningDone = true;

    emit("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      text: state.reasoningBuf
    });

    emit("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      part: { type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.reasoningIndex,
      item: {
        id: state.reasoningId,
        type: RESPONSES_ITEM.REASONING,
        summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: state.reasoningBuf }]
      }
    });
  }
}

function emitTextContent(state: Record<string, unknown>, emit: EmitFn, idx: number, content: string) {
  if (!(state.msgItemAdded as Record<string, unknown>)[idx]) {
    (state.msgItemAdded as Record<string, unknown>)[idx] = true;
    const msgId = `msg_${state.responseId}_${idx}`;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: msgId, type: RESPONSES_ITEM.MESSAGE, content: [], role: ROLE.ASSISTANT }
    });
  }

  if (!(state.msgContentAdded as Record<string, unknown>)[idx]) {
    (state.msgContentAdded as Record<string, unknown>)[idx] = true;

    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: `msg_${state.responseId}_${idx}`,
      output_index: idx,
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: "" }
    });
  }

  emit("response.output_text.delta", {
    type: "response.output_text.delta",
    item_id: `msg_${state.responseId}_${idx}`,
    output_index: idx,
    content_index: 0,
    delta: content,
    logprobs: []
  });

  if (!(state.msgTextBuf as Record<string, unknown>)[idx]) (state.msgTextBuf as Record<string, unknown>)[idx] = "";
  (state.msgTextBuf as Record<string, unknown>)[idx] = ((state.msgTextBuf as Record<string, unknown>)[idx] as string) + content;
}

function closeMessage(state: Record<string, unknown>, emit: EmitFn, idx: number | string) {
  if ((state.msgItemAdded as Record<string, unknown>)[idx] && !(state.msgItemDone as Record<string, unknown>)[idx]) {
    (state.msgItemDone as Record<string, unknown>)[idx] = true;
    const fullText = (state.msgTextBuf as Record<string, unknown>)[idx] || "";
    const msgId = `msg_${state.responseId}_${idx}`;

    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: msgId,
      output_index: parseInt(idx as string),
      content_index: 0,
      text: fullText,
      logprobs: []
    });

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: parseInt(idx as string),
      content_index: 0,
      part: { type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: fullText }
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx as string),
      item: {
        id: msgId,
        type: RESPONSES_ITEM.MESSAGE,
        content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, annotations: [], logprobs: [], text: fullText }],
        role: ROLE.ASSISTANT
      }
    });
  }
}

function isCustomTool(state: Record<string, unknown>, name: string) {
  return !!name && (state.customToolNames as Set<string>)?.has(name);
}

function extractCustomToolInput(argumentsText: unknown) {
  if (typeof argumentsText !== "string") return "";
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* incomplete or raw freeform input */ }
  return argumentsText;
}

function emitToolCall(state: Record<string, unknown>, emit: EmitFn, tc: Record<string, unknown>) {
  const tcIdx = (tc.index as number) ?? 0;
  const newCallId = tc.id as string;
  const funcName = (tc.function as Record<string, unknown>)?.name as string;

  if (funcName) (state.funcNames as Record<string, unknown>)[tcIdx] = funcName;
  if (newCallId) (state.funcCallIds as Record<string, unknown>)[tcIdx] = newCallId;

  // Some compatible providers split the call id and function name across
  // chunks. Wait for both before deciding whether this is a custom tool;
  // otherwise an `exec` call can be irreversibly announced as function_call.
  const callId = (state.funcCallIds as Record<string, unknown>)[tcIdx];
  if (!(state.funcItemAdded as Record<string, unknown>)[tcIdx] && callId && (state.funcNames as Record<string, unknown>)[tcIdx]) {
    (state.funcItemAdded as Record<string, unknown>)[tcIdx] = true;
    const custom = isCustomTool(state, (state.funcNames as Record<string, unknown>)[tcIdx] as string);

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: tcIdx,
      item: {
        id: `${custom ? "ctc" : "fc"}_${callId}`,
        type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
        ...(custom ? { input: "" } : { arguments: "" }),
        call_id: callId,
        name: (state.funcNames as Record<string, unknown>)[tcIdx] || ""
      }
    });
  }

  if (!(state.funcArgsBuf as Record<string, unknown>)[tcIdx]) (state.funcArgsBuf as Record<string, unknown>)[tcIdx] = "";

  if ((tc.function as Record<string, unknown>)?.arguments) {
    const refCallId = (state.funcCallIds as Record<string, unknown>)[tcIdx] || newCallId;
    if ((state.funcItemAdded as Record<string, unknown>)[tcIdx] && refCallId && !isCustomTool(state, (state.funcNames as Record<string, unknown>)[tcIdx] as string)) {
      emit("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: `fc_${refCallId}`,
        output_index: tcIdx,
        delta: (tc.function as Record<string, unknown>).arguments
      });
    }
    // Custom input is emitted once at close, after the Chat JSON wrapper can be
    // parsed and unwrapped. Streaming the raw JSON fragments would expose
    // {"input":"..."} instead of the freeform program Codex expects.
    (state.funcArgsBuf as Record<string, unknown>)[tcIdx] = ((state.funcArgsBuf as Record<string, unknown>)[tcIdx] as string) + (tc.function as Record<string, unknown>).arguments;
  }
}

function closeToolCall(state: Record<string, unknown>, emit: EmitFn, idx: number | string) {
  const callId = (state.funcCallIds as Record<string, unknown>)[idx];
  if (callId && !(state.funcItemDone as Record<string, unknown>)[idx]) {
    const args = (state.funcArgsBuf as Record<string, unknown>)[idx] || "{}";
    const custom = isCustomTool(state, (state.funcNames as Record<string, unknown>)[idx] as string);

    if (custom) {
      const input = extractCustomToolInput(args);
      emit("response.custom_tool_call_input.delta", {
        type: "response.custom_tool_call_input.delta",
        item_id: `ctc_${callId}`,
        output_index: parseInt(idx as string),
        delta: input
      });
      emit("response.custom_tool_call_input.done", {
        type: "response.custom_tool_call_input.done",
        item_id: `ctc_${callId}`,
        output_index: parseInt(idx as string),
        input
      });
    } else {
      emit("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: `fc_${callId}`,
        output_index: parseInt(idx as string),
        arguments: args
      });
    }

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx as string),
      item: {
        id: `${custom ? "ctc" : "fc"}_${callId}`,
        type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
        ...(custom ? { input: extractCustomToolInput(args) } : { arguments: args }),
        call_id: callId,
        name: (state.funcNames as Record<string, unknown>)[idx] || ""
      }
    });

    (state.funcItemDone as Record<string, unknown>)[idx] = true;
    (state.funcArgsDone as Record<string, unknown>)[idx] = true;
  }
}

function sendCompleted(state: Record<string, unknown>, emit: EmitFn) {
  if (!state.completedSent) {
    state.completedSent = true;
    emit("response.completed", {
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "completed",
        background: false,
        error: null
      }
    });
  }
}

function flushEvents(state: Record<string, unknown>) {
  if (state.completedSent) return [];

  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const nextSeq = () => ++(state.seq as number);
  const emit: EmitFn = (eventType, data) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  for (const i in state.msgItemAdded as Record<string, unknown>) closeMessage(state, emit, i);
  closeReasoning(state, emit);
  for (const i in state.funcCallIds as Record<string, unknown>) closeToolCall(state, emit, i);
  sendCompleted(state, emit);

  return events;
}

// currentToolCallId is intentionally sticky for the current turn so flush/completion
  // can still finalize as tool_calls even if the tool call was emitted before stream end.
function computeFinishReason(state: Record<string, unknown>) {
   return (state.toolCallIndex as number) > 0 || state.currentToolCallId
    ? OPENAI_FINISH.TOOL_CALLS
    : OPENAI_FINISH.STOP;
}

/**
 * Translate OpenAI Responses API chunk to OpenAI Chat Completions format
 * This is for when Codex returns data and we need to send it to an OpenAI-compatible client
 */
export function openaiResponsesToOpenAIResponse(chunk: unknown, state: unknown) {
  const s = state as Record<string, unknown>;

  if (!chunk) {
    // Flush: send final chunk with finish_reason
    if (s.finishReasonSent || !s.started) return null;

    const finishReason = computeFinishReason(s);

    s.finishReasonSent = true;
    s.finishReason = finishReason;

    const finalChunk = buildChunk(
      { id: (s.chatId as string) || `chatcmpl-${Date.now()}`, created: (s.created as number) || Math.floor(Date.now() / 1000), model: (s.model as string) || MODEL_FALLBACK },
      {},
      finishReason
    );

    if (s.usage && typeof s.usage === "object") {
      (finalChunk as Record<string, unknown>).usage = s.usage;
    }

    return finalChunk;
  }

  const c = chunk as Record<string, unknown>;

  // Handle different event types from Responses API
  const eventType = (c.type as string) || (c.event as string);
  const data = (c.data as Record<string, unknown>) || c;

  // Initialize state
  if (!s.started) {
    s.started = true;
    s.chatId = `chatcmpl-${Date.now()}`;
    s.created = Math.floor(Date.now() / 1000);
    s.toolCallIndex = 0;
    s.currentToolCallId = null;
  }

  // Text content delta
  if (eventType === "response.output_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;

    return buildChunk(
      { id: s.chatId as string, created: s.created as number, model: (s.model as string) || MODEL_FALLBACK },
      { content: delta }
    );
  }

  // Text content done (ignore, we handle via delta)
  if (eventType === "response.output_text.done") {
    return null;
  }

  // Function call started (standard function_call or custom_tool_call)
  if (eventType === "response.output_item.added" && ((data.item as Record<string, unknown>)?.type === RESPONSES_ITEM.FUNCTION_CALL || (data.item as Record<string, unknown>)?.type === "custom_tool_call")) {
    const item = data.item as Record<string, unknown>;
    s.currentToolCallId = (item.call_id as string) || fallbackToolCallId();

    return buildChunk(
      { id: s.chatId as string, created: s.created as number, model: (s.model as string) || MODEL_FALLBACK },
      {
        tool_calls: [{
          index: s.toolCallIndex as number,
          id: s.currentToolCallId,
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: (item.name as string) || "", arguments: "" }
        }]
      }
    );
  }

  // Function call arguments delta (standard or custom_tool_call variant)
  if (eventType === "response.function_call_arguments.delta" || eventType === "response.custom_tool_call_input.delta") {
    const argsDelta = data.delta || "";
    if (!argsDelta) return null;

    return buildChunk(
      { id: s.chatId as string, created: s.created as number, model: (s.model as string) || MODEL_FALLBACK },
      { tool_calls: [{ index: s.toolCallIndex as number, function: { arguments: argsDelta } }] }
    );
  }

  // Function call done (standard or custom_tool_call variant)
  if (eventType === "response.output_item.done" && ((data.item as Record<string, unknown>)?.type === RESPONSES_ITEM.FUNCTION_CALL || (data.item as Record<string, unknown>)?.type === "custom_tool_call")) {
    s.toolCallIndex = (s.toolCallIndex as number) + 1;
    return null;
  }

  // Response completed
  if (eventType === "response.completed" || eventType === "response.done") {
    // Extract usage from response.completed event
    const responseUsage = (data.response as Record<string, unknown>)?.usage as Record<string, unknown>;
    if (responseUsage && typeof responseUsage === "object") {
      const inputTokens = (responseUsage.input_tokens as number) || (responseUsage.prompt_tokens as number) || 0;
      const outputTokens = (responseUsage.output_tokens as number) || (responseUsage.completion_tokens as number) || 0;
      // OpenAI Responses API: input_tokens already includes cached_tokens
      // Cache info is in input_tokens_details.cached_tokens
      const cacheReadTokens = ((responseUsage.input_tokens_details as Record<string, unknown>)?.cached_tokens as number) || (responseUsage.cache_read_input_tokens as number) || 0;

      s.usage = buildUsage({ promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens, cachedTokens: cacheReadTokens });
    }

    if (!s.finishReasonSent) {
      const finishReason = computeFinishReason(s);

      s.finishReasonSent = true;
      s.finishReason = finishReason; // Mark for usage injection in stream.js

      const finalChunk = buildChunk(
        { id: s.chatId as string, created: s.created as number, model: (s.model as string) || MODEL_FALLBACK },
        {},
        finishReason
      );

      // Include usage in final chunk if available
      if (s.usage && typeof s.usage === "object") {
        (finalChunk as Record<string, unknown>).usage = s.usage;
      }

      return finalChunk;
    }
    return null;
  }

  // Error events from Responses API (e.g. model_not_found)
  if (eventType === "error" || eventType === "response.failed") {
    // Avoid emitting duplicate errors (error + response.failed arrive back-to-back)
    if (s.finishReasonSent) return null;

    const error = data.error || (data.response as Record<string, unknown>)?.error as Record<string, unknown>;
    if (error) {
      s.error = error;
      s.finishReasonSent = true;

      // Surface the error as an OpenAI-compatible error chunk
      return buildChunk(
        { id: (s.chatId as string) || `chatcmpl-${Date.now()}`, created: (s.created as number) || Math.floor(Date.now() / 1000), model: (s.model as string) || MODEL_FALLBACK },
        { content: `[Error] ${(error as Record<string, unknown>).message || JSON.stringify(error)}` },
        OPENAI_FINISH.STOP
      );
    }
    return null;
  }

  // Reasoning summary delta → emit as reasoning_content for client thinking display
  if (eventType === "response.reasoning_summary_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;
    return buildChunk(
      { id: s.chatId as string, created: s.created as number, model: (s.model as string) || MODEL_FALLBACK },
      reasoningDelta(delta as string)
    );
  }

  // Ignore other events
  return null;
}

// Register both directions
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);
