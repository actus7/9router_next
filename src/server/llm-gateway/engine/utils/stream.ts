import { translateResponse, initState } from "../translator/index";
import { FORMATS } from "../translator/formats";
import { trackPendingRequest, appendRequestLog } from "../host/usage";
import type { RequestLogger } from "./requestLogger";
import { extractUsage, mergeUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE } from "./streamHelpers";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers";
import { dbg, isDebugEnabled } from "./debugLog";


export { COLORS, formatSSE };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

// Helper: translateResponse attaches _openaiIntermediate as a non-standard array property
interface TranslatedArray extends Array<unknown> {
  _openaiIntermediate?: unknown[];
}

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate",    // Full translation between formats
  PASSTHROUGH: "passthrough" // No translation, normalize output, extract usage
} as const;

interface SSEStreamOptions {
  mode?: string;
  targetFormat?: string;
  sourceFormat?: string;
  provider?: string | null;
  reqLogger?: RequestLogger | null;
  toolNameMap?: Map<string, string> | null;
  customToolNames?: string[] | null;
  model?: string | null;
  connectionId?: string | null;
  body?: Record<string, unknown> | null;
  onStreamComplete?: ((content: { content: string; thinking: string }, usage: Record<string, unknown> | null, ttftAt: number | null) => void) | null;
  apiKey?: string | null;
}

/** Mutable state carried across transform/flush callbacks */
interface StreamContext {
  // Options (immutable after creation)
  mode: string;
  targetFormat?: string;
  sourceFormat?: string;
  provider: string | null;
  reqLogger: SSEStreamOptions["reqLogger"];
  model: string | null;
  connectionId: string | null;
  body: Record<string, unknown> | null;
  onStreamComplete: SSEStreamOptions["onStreamComplete"];
  apiKey: string | null;

  // Mutable stream state
  buffer: string;
  usage: Record<string, unknown> | null;
  decoder: TextDecoder;
  state: Record<string, unknown> | null;
  totalContentLength: number;
  accumulatedContent: string;
  accumulatedThinking: string;
  ttftAt: number | null;
  sseLineCount: number;
  sseEmittedCount: number;
  eventTypeCounts: Record<string, number>;
  currentOpenAIResponsesEvent: string | null;
  openAIResponsesTerminalSeen: boolean;
  openAIResponsesDoneSent: boolean;
  streamDoneSent: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalize a passthrough chunk: fix IDs, inject required fields, strip provider noise */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parseSSELine / JSON.parse return any; callers pass through
function normalizePassthroughChunk(parsed: any): { idFixed: boolean; fieldsInjected: boolean } {
  let fieldsInjected = false;
  const idFixed = fixInvalidId(parsed);

  // Ensure OpenAI-required fields are present on streaming chunks (Letta compat)
  if (parsed.choices !== undefined) {
    if (!parsed.object) { parsed.object = "chat.completion.chunk"; fieldsInjected = true; }
    if (!parsed.created) { parsed.created = Math.floor(Date.now() / 1000); fieldsInjected = true; }
  }

  // Strip Azure-specific non-standard fields from streaming chunks
  if (parsed.prompt_filter_results !== undefined) {
    delete parsed.prompt_filter_results;
    fieldsInjected = true;
  }
  if (parsed?.choices) {
    for (const choice of parsed.choices) {
      if (choice.content_filter_results !== undefined) {
        delete choice.content_filter_results;
        fieldsInjected = true;
      }
    }
  }

  // Strip empty tool_calls arrays that break AI SDK reasoning tracking.
  // Some providers (e.g. CodeBuddy CN) include `"tool_calls": []` in
  // every streaming delta. @ai-sdk/openai-compatible checks
  // `delta.tool_calls != null` — an empty array passes this check,
  // causing premature `reasoning-end` on every chunk.
  if (parsed?.choices) {
    for (const choice of parsed.choices) {
      if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
        delete choice.delta.tool_calls;
        fieldsInjected = true;
      }
    }
  }

  return { idFixed, fieldsInjected };
}

/** Track content/thinking tokens from a parsed chunk across all provider formats */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parseSSELine / JSON.parse return any; callers pass through
function trackContent(ctx: StreamContext, parsed: any) {
  // Claude format - content
  if (parsed.delta?.text) {
    ctx.totalContentLength += parsed.delta.text.length;
    ctx.accumulatedContent += parsed.delta.text;
  }
  // Claude format - thinking
  if (parsed.delta?.thinking) {
    ctx.totalContentLength += parsed.delta.thinking.length;
    ctx.accumulatedThinking += parsed.delta.thinking;
  }

  // OpenAI format - content
  if (parsed.choices?.[0]?.delta?.content) {
    ctx.totalContentLength += parsed.choices[0].delta.content.length;
    ctx.accumulatedContent += parsed.choices[0].delta.content;
  }
  // OpenAI format - reasoning
  if (parsed.choices?.[0]?.delta?.reasoning_content) {
    ctx.totalContentLength += parsed.choices[0].delta.reasoning_content.length;
    ctx.accumulatedThinking += parsed.choices[0].delta.reasoning_content;
  }

  // Gemini format
  if (parsed.candidates?.[0]?.content?.parts) {
    for (const part of parsed.candidates[0].content.parts) {
      if (part.text && typeof part.text === "string") {
        ctx.totalContentLength += part.text.length;
        // Check if this is thinking content
        if (part.thought === true) {
          ctx.accumulatedThinking += part.text;
        } else {
          ctx.accumulatedContent += part.text;
        }
      }
    }
  }
}

/** Emit translated items with optional usage injection and content filtering */
function emitTranslatedItems(ctx: StreamContext, translated: TranslatedArray, controller: TransformStreamDefaultController, injectUsage = false) {
  // Log OpenAI intermediate chunks (if available)
  if (translated?._openaiIntermediate) {
    for (const item of translated._openaiIntermediate) {
      const openaiOutput = formatSSE(item, FORMATS.OPENAI);
      ctx.reqLogger?.appendOpenAIChunk?.(openaiOutput);
    }
  }

  if (translated?.length > 0) {
    for (const item of translated) {
      if (item === null || item === undefined) continue;
      const itemRec = item as Record<string, unknown>;

      if (injectUsage) {
        // Filter empty chunks
        if (!hasValuableContent(itemRec, ctx.sourceFormat!)) {
          continue; // Skip this empty chunk
        }

        // Inject estimated usage if finish chunk has no valid usage
        const isFinishChunk = itemRec.type === "message_delta" || ((itemRec.choices as Record<string, unknown>[])?.[0] as Record<string, unknown>)?.finish_reason;
        if (ctx.state?.finishReason && isFinishChunk && !hasValidUsage(itemRec.usage as Record<string, unknown>) && ctx.totalContentLength > 0) {
          const estimated = estimateUsage(ctx.body, ctx.totalContentLength, ctx.sourceFormat!);
          itemRec.usage = filterUsageForFormat(estimated, ctx.sourceFormat!); // Filter + already has buffer
          ctx.state.usage = estimated;
        } else if (ctx.state?.finishReason && isFinishChunk && ctx.state.usage) {
          // Add buffer and filter usage for client (but keep original in state.usage for logging)
          const buffered = addBufferToUsage(ctx.state.usage as Record<string, unknown>);
          itemRec.usage = filterUsageForFormat(buffered, ctx.sourceFormat!);
        }
      }

      const output = formatSSE(item, ctx.sourceFormat!);
      ctx.reqLogger?.appendConvertedChunk?.(output);
      controller.enqueue(sharedEncoder.encode(output));
      if (injectUsage) ctx.sseEmittedCount++;
    }
  }
}

/** Process a single SSE line in passthrough mode */
function processPassthroughLine(ctx: StreamContext, line: string, trimmed: string, controller: TransformStreamDefaultController) {
  let output: string | undefined;
  let injectedUsage = false;

  if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
    try {
      const parsed = JSON.parse(trimmed.slice(5).trim());
      const { idFixed, fieldsInjected } = normalizePassthroughChunk(parsed);

      if (!hasValuableContent(parsed, FORMATS.OPENAI)) {
        return;
      }

      // Track content
      const delta = parsed.choices?.[0]?.delta;
      const content = delta?.content;
      const reasoning = delta?.reasoning_content;
      if (content && typeof content === "string") {
        ctx.totalContentLength += content.length;
        ctx.accumulatedContent += content;
      }
      if (reasoning && typeof reasoning === "string") {
        ctx.totalContentLength += reasoning.length;
        ctx.accumulatedThinking += reasoning;
      }

      // Extract usage
      const extracted = extractUsage(parsed);
      if (extracted) {
        ctx.usage = mergeUsage(ctx.usage, extracted);
      }

      // Finish chunk handling
      const isFinishChunk = parsed.choices?.[0]?.finish_reason;
      if (isFinishChunk && !hasValidUsage(parsed.usage)) {
        const estimated = estimateUsage(ctx.body, ctx.totalContentLength, FORMATS.OPENAI);
        parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
        output = `data: ${JSON.stringify(parsed)}\n`;
        ctx.usage = estimated;
        injectedUsage = true;
      } else if (isFinishChunk && ctx.usage) {
        const buffered = addBufferToUsage(ctx.usage);
        parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
        output = `data: ${JSON.stringify(parsed)}\n`;
        injectedUsage = true;
      } else if (idFixed || fieldsInjected) {
        output = `data: ${JSON.stringify(parsed)}\n`;
        injectedUsage = true;
      }
    } catch {
      // Skip non-JSON data lines silently — don't forward garbage to clients.
      // Upstream providers sometimes return plain-text errors (HTML, rate-limit
      // messages) in the SSE stream that would break downstream JSON decoders.
      return;
    }
  }

  if (!injectedUsage) {
    if (line.startsWith("data:") && !line.startsWith("data: ")) {
      output = "data: " + line.slice(5) + "\n";
    } else {
      output = line + "\n";
    }
  }

  if (output) {
    ctx.reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
  }
}

/** Process a single SSE line in translate mode */
function processTranslateLine(ctx: StreamContext, _line: string, trimmed: string, controller: TransformStreamDefaultController) {
  if (!trimmed) return;

  const parsed = parseSSELine(trimmed, ctx.targetFormat);
  if (!parsed) return;

  // Responses API same-format passthrough: preserve event framing + track terminal state
  const isOpenAIResponsesStream = ctx.targetFormat === FORMATS.OPENAI_RESPONSES;
  const keepsOpenAIResponsesFormat = isOpenAIResponsesStream && ctx.sourceFormat === FORMATS.OPENAI_RESPONSES;
  const openAIResponsesEventName = isOpenAIResponsesStream
    ? getOpenAIResponsesEventName(ctx.currentOpenAIResponsesEvent, parsed)
    : null;

  if (isOpenAIResponsesStream && isOpenAIResponsesTerminalEvent(openAIResponsesEventName, parsed)) {
    ctx.openAIResponsesTerminalSeen = true;
  }

  // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
  // For other formats: done=true is the [DONE] sentinel, skip
  if (parsed.done && ctx.targetFormat !== FORMATS.OLLAMA) {
    // Synthesize response.failed if the Responses stream never sent a terminal event
    if (keepsOpenAIResponsesFormat && !ctx.openAIResponsesTerminalSeen) {
      const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
      ctx.reqLogger?.appendConvertedChunk?.(failedOutput);
      controller.enqueue(sharedEncoder.encode(failedOutput));
      ctx.openAIResponsesTerminalSeen = true;
      ctx.sseEmittedCount++;
    }

    if (keepsOpenAIResponsesFormat && !ctx.streamDoneSent) {
      const doneOutput = "data: [DONE]\n\n";
      ctx.reqLogger?.appendConvertedChunk?.(doneOutput);
      controller.enqueue(sharedEncoder.encode(doneOutput));
    }
    ctx.streamDoneSent = true;
    if (keepsOpenAIResponsesFormat) ctx.openAIResponsesDoneSent = true;
    return;
  }

  // Track content across formats
  trackContent(ctx, parsed);

  // Extract usage
  const extracted = extractUsage(parsed);
  if (extracted && ctx.state) ctx.state.usage = mergeUsage(ctx.state.usage as Record<string, unknown> | null, extracted); // Keep original usage for logging

  // Responses same-format passthrough: re-emit with original event framing
  if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
    const output = formatSSE({ event: openAIResponsesEventName, data: parsed }, ctx.sourceFormat ?? "");
    ctx.reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
    ctx.currentOpenAIResponsesEvent = null;
    ctx.sseEmittedCount++;
    return;
  }

  ctx.currentOpenAIResponsesEvent = null;

  // Translate: targetFormat -> openai -> sourceFormat
  const translated = translateResponse(ctx.targetFormat!, ctx.sourceFormat!, parsed, ctx.state!) as TranslatedArray;
  emitTranslatedItems(ctx, translated, controller, true);
}

/** Flush remaining buffer and finalize in passthrough mode */
function flushPassthrough(ctx: StreamContext, controller: TransformStreamDefaultController) {
  if (ctx.buffer) {
    let output = ctx.buffer;
    if (ctx.buffer.startsWith("data:") && !ctx.buffer.startsWith("data: ")) {
      output = "data: " + ctx.buffer.slice(5);
    }
    ctx.reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
  }

  if (!hasValidUsage(ctx.usage) && ctx.totalContentLength > 0) {
    ctx.usage = estimateUsage(ctx.body, ctx.totalContentLength, FORMATS.OPENAI);
  }

  if (hasValidUsage(ctx.usage)) {
    logUsage(ctx.provider, ctx.usage!, ctx.model, ctx.connectionId, ctx.apiKey);
  } else {
    appendRequestLog().catch(() => { });
  }

  // IMPORTANT: In passthrough mode we still must terminate the SSE stream.
  // Some clients (e.g. OpenClaw) expect the OpenAI-style sentinel:
  //   data: [DONE]\n\n
  // Without it they can hang until timeout and trigger failover.
  // Gemini-family clients (Antigravity, Vertex, Gemini) reject this sentinel with 400 syntax errors.
  const isGeminiFamily = ctx.provider === "antigravity" || ctx.provider === "gemini" || ctx.provider === "vertex";
  if (!ctx.streamDoneSent && !isGeminiFamily) {
    const doneOutput = "data: [DONE]\n\n";
    ctx.reqLogger?.appendConvertedChunk?.(doneOutput);
    controller.enqueue(sharedEncoder.encode(doneOutput));
  }

  if (ctx.onStreamComplete) {
    ctx.onStreamComplete({
      content: ctx.accumulatedContent,
      thinking: ctx.accumulatedThinking
    }, ctx.usage, ctx.ttftAt);
  }
}

/** Flush remaining buffer and finalize in translate mode */
function flushTranslate(ctx: StreamContext, controller: TransformStreamDefaultController) {
  if (ctx.buffer.trim()) {
    const parsed = parseSSELine(ctx.buffer.trim());
    if (parsed && !parsed.done) {
      const translated = translateResponse(ctx.targetFormat!, ctx.sourceFormat!, parsed, ctx.state!) as TranslatedArray;
      emitTranslatedItems(ctx, translated, controller);
    }
  }

  const flushed = translateResponse(ctx.targetFormat!, ctx.sourceFormat!, null, ctx.state!) as TranslatedArray;
  emitTranslatedItems(ctx, flushed, controller);

  // Synthesize response.failed if a Responses passthrough stream never reached a terminal event
  const keepsOpenAIResponsesFormat = ctx.targetFormat === FORMATS.OPENAI_RESPONSES && ctx.sourceFormat === FORMATS.OPENAI_RESPONSES;
  if (keepsOpenAIResponsesFormat && !ctx.openAIResponsesTerminalSeen) {
    const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
    ctx.reqLogger?.appendConvertedChunk?.(failedOutput);
    controller.enqueue(sharedEncoder.encode(failedOutput));
    ctx.openAIResponsesTerminalSeen = true;
  }

  if (keepsOpenAIResponsesFormat && !ctx.openAIResponsesDoneSent && !ctx.streamDoneSent) {
    const doneOutput = "data: [DONE]\n\n";
    ctx.reqLogger?.appendConvertedChunk?.(doneOutput);
    controller.enqueue(sharedEncoder.encode(doneOutput));
    ctx.openAIResponsesDoneSent = true;
    ctx.streamDoneSent = true;
  }

  if (ctx.state && !hasValidUsage(ctx.state.usage as Record<string, unknown>) && ctx.totalContentLength > 0) {
    ctx.state.usage = estimateUsage(ctx.body, ctx.totalContentLength, ctx.sourceFormat!);
  }

  if (ctx.state && hasValidUsage(ctx.state.usage as Record<string, unknown>)) {
    logUsage((ctx.state.provider as string) || ctx.targetFormat!, ctx.state.usage as Record<string, unknown>, ctx.model, ctx.connectionId, ctx.apiKey);
  } else {
    appendRequestLog().catch(() => { });
  }

  if (ctx.onStreamComplete) {
    ctx.onStreamComplete({
      content: ctx.accumulatedContent,
      thinking: ctx.accumulatedThinking
    }, (ctx.state?.usage as Record<string, unknown>) ?? null, ctx.ttftAt);
  }
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.body - Request body (for input token estimation)
 * @param {function} options.onStreamComplete - Callback when stream completes (content, usage)
 * @param {string} options.apiKey - API key for usage tracking
 */
function createSSEStream(options: SSEStreamOptions = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    customToolNames = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null
  } = options;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state: Record<string, unknown> | null = mode === STREAM_MODE.TRANSLATE
    ? { ...initState(sourceFormat ?? ""), provider, toolNameMap, customToolNames: new Set(customToolNames || []), model }
    : null;

  const ctx: StreamContext = {
    mode, targetFormat, sourceFormat, provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey,
    buffer: "",
    usage: null,
    decoder,
    state,
    totalContentLength: 0,
    accumulatedContent: "",
    accumulatedThinking: "",
    ttftAt: null,
    sseLineCount: 0,
    sseEmittedCount: 0,
    eventTypeCounts: {},
    currentOpenAIResponsesEvent: null,
    openAIResponsesTerminalSeen: false,
    openAIResponsesDoneSent: false,
    streamDoneSent: false,
  };

  return new TransformStream({
    transform(chunk, controller) {
      if (!ctx.ttftAt) ctx.ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
      ctx.buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = ctx.buffer.split("\n");
      ctx.buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (isDebugEnabled && trimmed) {
          ctx.sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            ctx.eventTypeCounts[evt] = (ctx.eventTypeCounts[evt] || 0) + 1;
          }
        }

        // Capture Responses API event name to preserve framing in same-format passthrough
        if (mode === STREAM_MODE.TRANSLATE && targetFormat === FORMATS.OPENAI_RESPONSES && trimmed.startsWith("event:")) {
          ctx.currentOpenAIResponsesEvent = trimmed.slice(6).trim();
        }

        // Dispatch to mode-specific handler
        if (mode === STREAM_MODE.PASSTHROUGH) {
          processPassthroughLine(ctx, line, trimmed, controller);
        } else {
          processTranslateLine(ctx, line, trimmed, controller);
        }
      }
    },

    flush(controller) {
      const evtSummary = Object.entries(ctx.eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${ctx.sseLineCount} | emitted=${ctx.sseEmittedCount} | events=[${evtSummary}]`);
      trackPendingRequest(model ?? "", provider ?? "", connectionId ?? "", false);
      try {
        const remaining = decoder.decode();
        if (remaining) ctx.buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          flushPassthrough(ctx, controller);
          return;
        }

        flushTranslate(ctx, controller);
      } catch (error) {
        console.error("Error in flush:", error);
      }
    }
  });
}

export function createSSETransformStreamWithLogger(targetFormat: string, sourceFormat: string, provider: string | null = null, reqLogger: SSEStreamOptions["reqLogger"] = null, toolNameMap: SSEStreamOptions["toolNameMap"] = null, model: string | null = null, connectionId: string | null = null, body: Record<string, unknown> | null = null, onStreamComplete: SSEStreamOptions["onStreamComplete"] = null, apiKey: string | null = null, customToolNames: string[] | null = null) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    customToolNames,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey
  });
}

export function createPassthroughStreamWithLogger(provider: string | null = null, reqLogger: SSEStreamOptions["reqLogger"] = null, model: string | null = null, connectionId: string | null = null, body: Record<string, unknown> | null = null, onStreamComplete: SSEStreamOptions["onStreamComplete"] = null, apiKey: string | null = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey
  });
}
