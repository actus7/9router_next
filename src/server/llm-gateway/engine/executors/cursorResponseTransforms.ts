import { HTTP_STATUS } from "../config/runtimeConfig";
import { FORMATS } from "../translator/formats";
import { extractTextFromResponse } from "../utils/cursorProtobuf";
import { estimateUsage } from "../utils/usageTracking";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants";
import { chatChunkSse } from "../utils/sse";
import {
  createErrorResponse,
  debugLog,
  isComposerModel,
  processSseFrame,
  readCursorFrame,
  type SseFrameState,
  visibleComposerContentFromThinking,
} from "./cursorSseProtocol";

export function transformCursorProtobufToJSON(buffer: Buffer<ArrayBufferLike>, model: string, body: Record<string, unknown>) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, "");
      if (frame.status === "done") break;
      offset = frame.offset!;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload!;

      // Check for JSON error frames (byte guard: skip toString on non-JSON frames)
      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload) as Uint8Array<ArrayBuffer>);
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;
        } else {
          // New tool call
          toolCallsMap.set(tc.id, { ...tc });
        }

        // Push to final array when isLast is true
        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id);
          finalizedIds.add(tc.id);
          toolCalls.push({
            id: finalToolCall.id,
            type: finalToolCall.type,
            function: {
              name: finalToolCall.function.name,
              arguments: finalToolCall.function.arguments
            }
          });
        }
      }

      if (result.text) totalContent += result.text;
      if (result.thinking) totalThinking += result.thinking;
    }

    const visibleComposerContent = isComposerModel(model)
      ? visibleComposerContentFromThinking(totalThinking)
      : "";
    const finalContent = totalContent || visibleComposerContent;

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (in case stream ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      // Check if already in final array
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`);


    const message: Record<string, unknown> = {
      role: "assistant",
      content: finalContent || null
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const usage = estimateUsage(body, finalContent.length, FORMATS.OPENAI);

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

export function transformCursorProtobufToSSE(buffer: Buffer<ArrayBufferLike>, model: string, body: Record<string, unknown>) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const state: SseFrameState = {
      chunks: [],
      totalContent: "",
      totalThinking: "",
      emittedComposerThinkingContentLength: 0,
      toolCalls: [],
      toolCallsMap: new Map(),
      finalizedIds: new Set(),
      emittedToolCallIds: new Set(),
      responseId,
      created,
      model
    };

    let offset = 0;
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, " SSE");
      if (frame.status === "done") break;
      offset = frame.offset!;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload!;

      const frameResult = processSseFrame(state, payload, frameCount);
      if (frameResult.action === "return") return frameResult.response;
      if (frameResult.action === "break") break;
    }

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${frameCount} frames, toolCallsMap size: ${state.toolCallsMap.size}, toolCalls array: ${state.toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (stream may have ended without isLast=true)
    for (const [id, tc] of state.toolCallsMap.entries()) {
      if (!state.finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        const toolCallIndex: number = state.toolCalls.length;
        state.toolCalls.push({
          id: tc.id,
          type: tc.type,
          index: toolCallIndex,
          isLast: tc.isLast,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });

        // Emit SSE chunk for the finalized tool call if not already emitted
        if (!state.emittedToolCallIds.has(tc.id)) {
          state.chunks.push(chatChunkSse({
            id: state.responseId, created: state.created, model: state.model,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            }
          }));
        }
      }
    }

    if (state.chunks.length === 0 && state.toolCalls.length === 0) {
      state.chunks.push(chatChunkSse({ id: state.responseId, created: state.created, model: state.model, delta: { role: "assistant", content: "" } }));
    }

    const usage = estimateUsage(body, state.totalContent.length, FORMATS.OPENAI);

    state.chunks.push(
      `data: ${JSON.stringify({
        id: state.responseId,
        object: "chat.completion.chunk",
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: state.toolCalls.length > 0 ? "tool_calls" : "stop"
          }
        ],
        usage
      })}\n\n`
    );
    state.chunks.push(SSE_DONE);

    return new Response(state.chunks.join(""), {
      status: 200,
      headers: { ...SSE_HEADERS }
    });
  }
