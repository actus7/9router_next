import { SSE_DONE } from "../utils/sseConstants";
import { parseEventFrame } from "./kiroEventFrame";
import {
  EVENTSTREAM_MAX_HEADERS_BYTES,
  EVENTSTREAM_MAX_MESSAGE_BYTES,
  KIRO_EVENT_TYPES,
  KIRO_TRUNCATION_STOP_REASONS,
  crc32,
  emitDelta,
  emitTools,
  encoder,
  failTransform,
  handleAssistantResponseEvent,
  handleMetricsEvent,
  handleToolUseEvent,
  makeDiagnostics,
  makeSseChunk,
  mergeStopReason,
  normalizeStopReason,
  stopDisposition,
  type EventFrame,
  type TransformContext,
} from "./kiroEventStreamCore";

export function processEvent(event: EventFrame, controller: ReadableStreamDefaultController<Uint8Array>, ctx: TransformContext): boolean {
  const messageType = event.headers[":message-type"];
  if (messageType === "error" || messageType === "exception") {
    failTransform(
      ctx,
      controller,
      "upstream_eventstream_error",
      "kiro_upstream_eventstream_error",
      (event.payload?.message as string) || `Kiro upstream sent an EventStream ${messageType}`,
      { transport_state: "upstream_error" }
    );
    return false;
  }

  const eventType = (event.headers[":event-type"] as string) || "";
  const eventCountKey = KIRO_EVENT_TYPES.has(eventType) ? eventType : "other";
  ctx.eventCounts[eventCountKey] = (ctx.eventCounts[eventCountKey] || 0) + 1;
  if (eventType === "assistantResponseEvent") {
    handleAssistantResponseEvent(event, controller, ctx);
  } else if (eventType === "reasoningContentEvent") {
    const value = event.payload?.reasoningContentEvent || event.payload || {};
    const content = typeof value === "string" ? value : (value as Record<string, unknown>).text || (value as Record<string, unknown>).content || "";
    if (content) {
      ctx.state.hasReasoning = true;
      ctx.state.totalContentLength += (content as string).length;
      emitDelta(ctx, controller, { reasoning_content: content });
    }
  } else if (eventType === "codeEvent" && typeof event.payload?.content === "string") {
    ctx.state.hasCode = true;
    ctx.state.totalContentLength += event.payload.content.length;
    emitDelta(ctx, controller, { content: event.payload.content });
  } else if (eventType === "toolUseEvent") {
    handleToolUseEvent(event, controller, ctx);
  } else if (eventType === "messageStopEvent") {
    ctx.state.explicitStop = true;
    const reason = normalizeStopReason(
      event.payload?.stopReason ?? event.payload?.stop_reason
    ) || (ctx.state.sawToolUse ? "tool_use" : "end_turn");
    const merged = mergeStopReason(ctx.state.stopReason, reason);
    if (merged !== ctx.state.stopReason) ctx.state.terminalProvenance = "message_stop_event";
    ctx.state.stopReason = merged;
  } else if (eventType === "metadataEvent" || eventType === "MetadataEvent") {
    const metadata = (event.payload?.metadataEvent || event.payload?.metadata || event.payload) as Record<string, unknown> | undefined;
    const reason = normalizeStopReason(metadata?.stopReason ?? metadata?.stop_reason);
    if (reason) {
      ctx.state.explicitStop = true;
      const merged = mergeStopReason(ctx.state.stopReason, reason);
      if (merged !== ctx.state.stopReason) ctx.state.terminalProvenance = "metadata_stop_reason";
      ctx.state.stopReason = merged;
    }
  } else if (eventType === "contextUsageEvent") {
    const percentage = Number(event.payload?.contextUsagePercentage);
    if (Number.isFinite(percentage)) {
      ctx.state.contextUsagePercentage = percentage;
      ctx.state.hasContextUsage = true;
    }
  } else if (eventType === "meteringEvent") {
    ctx.state.hasMetering = true;
    const metering = (event.payload?.meteringEvent || event.payload || {}) as Record<string, unknown>;
    const credits = Number(metering.usage);
    if (Number.isFinite(credits)) {
      ctx.state.usage = {
        ...(ctx.state.usage || {}),
        kiro_credits: credits,
        kiro_credit_unit: typeof metering.unit === "string" ? metering.unit : "credit"
      };
    }
  } else if (eventType === "metricsEvent") {
    handleMetricsEvent(event, ctx);
  }
  return true;
}




export function processBytes(chunk: Uint8Array, controller: ReadableStreamDefaultController<Uint8Array>, ctx: TransformContext): boolean {
  const combinedLength = ctx.state.buffer.byteLength + chunk.byteLength;
  if (combinedLength > (ctx.options.maxRawBytes || EVENTSTREAM_MAX_MESSAGE_BYTES)) {
    failTransform(
      ctx,
      controller,
      "corrupt_eventstream_frame",
      "kiro_missing_terminal",
      "Kiro EventStream buffered bytes exceed the protocol bound"
    );
    return false;
  }
  if (ctx.state.buffer.byteLength === 0) {
    ctx.state.buffer = chunk;
  } else {
    const joined = new Uint8Array(combinedLength);
    joined.set(ctx.state.buffer);
    joined.set(chunk, ctx.state.buffer.byteLength);
    ctx.state.buffer = joined;
  }

  while (ctx.state.buffer.byteLength >= 12) {
    const view = new DataView(ctx.state.buffer.buffer, ctx.state.buffer.byteOffset);
    if (view.getUint32(8, false) !== crc32(ctx.state.buffer.subarray(0, 8))) {
      failTransform(ctx, controller, "corrupt_eventstream_frame", "kiro_missing_terminal", "Kiro EventStream prelude CRC mismatch");
      return false;
    }
    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);
    if (totalLength < 16 || totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES ||
        headersLength > EVENTSTREAM_MAX_HEADERS_BYTES || headersLength > totalLength - 16) {
      failTransform(ctx, controller, "corrupt_eventstream_frame", "kiro_missing_terminal", "Kiro EventStream frame bounds are invalid");
      return false;
    }
    if (ctx.state.buffer.byteLength < totalLength) break;
    const frame = ctx.state.buffer.slice(0, totalLength);
    ctx.state.buffer = ctx.state.buffer.slice(totalLength);
    let event: EventFrame;
    try {
      event = parseEventFrame(frame);
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      failTransform(ctx, controller, "corrupt_eventstream_frame", "kiro_missing_terminal", error.message);
      return false;
    }
    ctx.state.transportState = "valid_complete_frame";
    ctx.state.validatedFrames++;
    try {
      if (!processEvent(event, controller, ctx)) return false;
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      const bufferExceeded = (error as Error & { code?: string }).code === "KIRO_BUFFER_EXCEEDED";
      if (!bufferExceeded) {
        // Keep whatever is already buffered: the rejected fragment belongs to
        // one tool, and clearing the map dropped the complete calls too.
        ctx.state.toolValidationError ||= error.message;
        console.error(`[Kiro] tool fragment rejected, keeping ${ctx.state.tools.size} buffered tool(s): ${error.message}`);
        continue;
      }
      failTransform(
        ctx,
        controller,
        "integrity_buffer_exceeded",
        "kiro_integrity_buffer_exceeded",
        error.message,
        {
          transport_state: ctx.state.transportState,
          stop_disposition: "terminal_incomplete"
        }
      );
      return false;
    }
  }
  return true;
}

function checkDispositionFail(
  ctx: TransformContext,
  controller: ReadableStreamDefaultController<Uint8Array>,
  hasToolCalls: boolean,
  logSuffix: string
): { disposition: string; truncatedAfterOutput: boolean; shouldReturn: boolean } {
  const disposition = stopDisposition(ctx.state.stopReason, hasToolCalls);
  const truncatedAfterOutput = disposition === "terminal_incomplete" &&
    KIRO_TRUNCATION_STOP_REASONS.has(ctx.state.stopReason ?? "") && ctx.state.chunkIndex > 0;
  if (truncatedAfterOutput) {
    console.error(`[Kiro] truncated after ${ctx.state.chunkIndex} chunk(s) (stop_reason=${ctx.state.stopReason}); ${logSuffix}`);
  }
  if (!truncatedAfterOutput && ["retryable_protocol_failure", "terminal_incomplete", "terminal_refusal", "unknown_failure"].includes(disposition)) {
    const code = disposition === "retryable_protocol_failure"
      ? "kiro_retryable_protocol_failure"
      : disposition === "terminal_refusal"
        ? "kiro_terminal_refusal"
        : disposition === "terminal_incomplete"
          ? "kiro_terminal_incomplete"
          : "kiro_unknown_stop_reason";
    failTransform(
      ctx,
      controller,
      ctx.state.terminalProvenance || "metadata_stop_reason",
      code,
      `Kiro ended with non-success stop reason: ${ctx.state.stopReason}`,
      { transport_state: ctx.state.transportState, stop_disposition: disposition }
    );
    return { disposition, truncatedAfterOutput: false, shouldReturn: true };
  }
  return { disposition, truncatedAfterOutput, shouldReturn: false };
}

export function finishStream(ctx: TransformContext, controller: ReadableStreamDefaultController<Uint8Array>): void {
  if (ctx.state.finished) return;
  if (ctx.state.buffer.byteLength) {
    failTransform(ctx, controller, "incomplete_eventstream_frame", "kiro_missing_terminal",
      "Kiro EventStream ended with a truncated frame", { transport_state: "incomplete_frame" });
    return;
  }
  ctx.state.transportState = "clean_eof";

  // model_context_window_exceeded / max_tokens map to terminal_incomplete. When
  // they arrive after the model already streamed content, fail() threw away a
  // complete-enough answer; a truncated turn is what finish_reason "length" is
  // for. chunkIndex > 0 means at least one delta already reached the client.
  const declared = checkDispositionFail(ctx, controller, ctx.state.sawToolUse, "keeping output");
  if (declared.shouldReturn) return;

  try {
    emitTools(ctx, controller);
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    failTransform(ctx, controller, "invalid_tool_call", "invalid_kiro_tool_call", error.message,
      { transport_state: ctx.state.transportState, stop_disposition: "retryable_protocol_failure" });
    return;
  }
  // Fail only when the turn has nothing usable left. emitTools() validates
  // per tool and drops just the unusable ones, so this has to run AFTER it:
  // before, the rejected tool was still buffered and tools.size was never 0.
  // A turn that also produced text keeps that text -- the dropped call is
  // logged, not fatal.
  if (ctx.state.toolValidationError && !ctx.state.hasToolCalls &&
      !ctx.state.hasText && !ctx.state.hasReasoning && !ctx.state.hasCode) {
    failTransform(ctx, controller, "invalid_tool_call", "invalid_kiro_tool_call",
      ctx.state.toolValidationError,
      { transport_state: ctx.state.transportState, stop_disposition: "retryable_protocol_failure" });
    return;
  }

  const hasOutput = ctx.state.hasText || ctx.state.hasReasoning || ctx.state.hasCode || ctx.state.hasToolCalls;
  if (!hasOutput && !ctx.state.explicitStop) {
    failTransform(ctx, controller, "empty_response_eof", "kiro_missing_terminal",
      "Kiro EventStream ended without model output", { transport_state: ctx.state.transportState });
    return;
  }

  const final = checkDispositionFail(ctx, controller, ctx.state.hasToolCalls, "closing as length");
  if (final.shouldReturn) return;

  if (ctx.state.hasMetering && ctx.state.hasContextUsage && !ctx.state.usage?.total_tokens) {
    const completion = ctx.state.totalContentLength
      ? Math.max(1, Math.floor(ctx.state.totalContentLength / 4))
      : 0;
    const prompt = Math.floor(ctx.state.contextUsagePercentage * ctx.contextWindow / 100);
    ctx.state.usage = {
      ...(ctx.state.usage || {}),
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion
    };
  }
  const finishReason = final.truncatedAfterOutput
    ? "length"
    : ctx.state.hasToolCalls
      ? "tool_calls"
      : final.disposition === "length"
        ? "length"
        : "stop";
  controller.enqueue(makeSseChunk(ctx, {}, finishReason, ctx.state.usage));
  controller.enqueue(encoder.encode(SSE_DONE));
  ctx.state.finished = true;
  ctx.options.onTerminalState?.(makeDiagnostics(ctx, {
    terminal_provenance: ctx.state.terminalProvenance || "clean_eventstream_eof",
    transport_state: ctx.state.transportState,
    // Report what this exit actually did, not the raw disposition. The
    // integrity gate re-derives its verdict from stop_disposition, so
    // reporting "terminal_incomplete" for a turn we deliberately kept made
    // it discard the very bytes we just released to the client.
    stop_disposition: final.truncatedAfterOutput ? "length" : final.disposition
  }));
}




