// ── File-local types ─────────────────────────────────────────────────────────

export interface SSEDiagnostics {
  terminal_provenance?: string;
  transport_state?: string;
  stop_reason?: string | null;
  stop_disposition?: string;
  response_state?: string;
  event_counts?: Record<string, number>;
  incomplete_frame_bytes?: number;
  [key: string]: unknown;
}

export interface IntegrityAttempt {
  kind: string;
  message?: string;
  bytes?: Uint8Array;
  diagnostics?: SSEDiagnostics;
}

export interface IntegrityOptions {
  signal: AbortSignal;
  maxBytes: number;
  ttftTimeoutMs: number;
  stallTimeoutMs: number;
  repairEnabled: boolean;
  maxToolBytes?: number;
  maxRawBytes?: number;
  onTerminalState?: (detail: SSEDiagnostics) => void;
}

export interface TransformOptions {
  maxToolBytes?: number;
  maxRawBytes?: number;
  onTerminalState?: (detail: SSEDiagnostics) => void;
}

export interface ToolEntry {
  id: string;
  name: string;
  inputKind?: string;
  inputChunks?: string[];
  inputObject?: unknown;
  inputBytes?: number;
}

export interface EventStreamState {
  buffer: Uint8Array;
  chunkIndex: number;
  toolCounter: number;
  tools: Map<string, ToolEntry>;
  bufferedToolBytes: number;
  hasText: boolean;
  hasReasoning: boolean;
  hasCode: boolean;
  hasToolCalls: boolean;
  sawToolUse: boolean;
  explicitStop: boolean;
  stopReason: string | null;
  terminalProvenance: string | null;
  transportState: string;
  totalContentLength: number;
  contextUsagePercentage: number;
  hasContextUsage: boolean;
  hasMetering: boolean;
  usage: Record<string, number | string> | null;
  inThinking: boolean;
  toolValidationError: string | null;
  validatedFrames: number;
  finished: boolean;
  droppedTools?: number;
}

export interface EventFrame {
  headers: Record<string, unknown>;
  payload: Record<string, unknown> | null;
}

export interface InspectState {
  content: string;
  reasoning: string;
  hasToolCalls: boolean;
  error: Record<string, unknown> | null;
}

export interface TransformContext {
  state: EventStreamState;
  options: TransformOptions;
  responseId: string;
  created: number;
  model: string;
  contextWindow: number;
  eventCounts: Record<string, number>;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const KIRO_REPAIR_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
export const KIRO_REPAIR_HEARTBEAT_MS = 10_000;
const KIRO_SHORT_FINAL_MAX_CHARS = 800;
export const EVENTSTREAM_MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
export const EVENTSTREAM_MAX_HEADERS_BYTES = 128 * 1024;
export const KIRO_EVENT_TYPES = new Set([
  "assistantResponseEvent",
  "reasoningContentEvent",
  "codeEvent",
  "toolUseEvent",
  "messageStopEvent",
  "metadataEvent",
  "MetadataEvent",
  "contextUsageEvent",
  "meteringEvent",
  "metricsEvent"
]);
export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

const REPAIR_INSTRUCTIONS = Object.freeze({
  tool: "Retry the previous response because its Kiro tool_call wrapper was malformed. If you use the wrapper tool named tool_call, its input must contain a non-empty name and an arguments field.",
  ellipsis: "Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….",
  short_final: "Retry the previous response because its final only announced a future action. Complete the check now and return the result or a concrete blocker."
});
const SHORT_FUTURE_ACTION = /^(?:(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再)(?:補|查|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|我(?:會|要|將)(?:再|重新)?(?:補(?:齊|查)?|抓取|查(?:詢)?|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b)/iu;
// Keep this tied to the observed whole-response signature. Broader Chinese
// result/progress heuristics create false positives for completed findings.
const OBSERVED_TRAILING_FUTURE_ACTION = /^目前證據顯示[\s\S]{1,700}[。.!?；;]\s*最後補查\s+504\s+access\s+log[，,]\s*確認\s+host[／/]路徑與是否為集中流量[。.!]?$/iu;
const ENGLISH_FUTURE_ACTION = /^(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b/iu;
const ENGLISH_RESULT_CLAUSE = /(?:[:;\n]|[.!?]\s+\S|\b(?:status|checksum|response|deployment)\s+(?:is|are|was|were|matches?|equals?|returned)\b)/iu;
const CHINESE_FUTURE_ACTION = /^(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再|我(?:會|要|將)(?:再|重新)?)(?:補|抓取|查|確認|驗證|追|繼續|檢查|測試)/u;
const CHINESE_RESULT_CLAUSE = /(?:[。！？]\s*\S|(?:版本|狀態|回應|結果|部署|校驗碼)(?:是|為|等於|顯示))/u;
const USER_WAIT = /(?:請(?:你|先)|你(?:先|需要|可以|提供|確認|批准|允許)|等待(?:你|使用者)|等你|核准|同意|授權|\b(?:after|when|once)\s+you\b|\byour\s+(?:approval|confirmation|permission|input)\b|\bwait(?:ing)?\s+for\s+you\b|\bplease\s+(?:approve|confirm|provide|send)\b)/iu;
const COMPLETED_FINAL = /(?:已(?:經)?完成|完成(?:了|驗證|確認)|修復完成|確認無誤|驗證(?:完成|通過)|測試(?:均)?通過|結論|總結|\b(?:done|completed|fixed|verified|confirmed|passed|in conclusion|summary)\b|\b(?:is|are) complete\b)/iu;
const RESULT_EVIDENCE = /(?:顯示|發現|因此|成功|失敗|正常|無錯誤|沒有錯誤|\b(?:found|shows?|showed|because|therefore|succeeded|failed|healthy|green|no errors?)\b)/iu;

// ── Helper functions ─────────────────────────────────────────────────────────

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function envPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env?.[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function makeAbortError(reason: unknown): Error {
  const reasonMsg = (reason as Error)?.message || String(reason || "Request aborted");
  const error = new Error(reasonMsg);
  error.name = "AbortError";
  return error;
}

export async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal | undefined, timeoutMs: number, message: string) {
  if (signal?.aborted) throw makeAbortError(signal.reason);
  let timeout!: ReturnType<typeof setTimeout>;
  let abortHandler: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => reject(makeAbortError(signal?.reason));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timeout);
    if (abortHandler) signal?.removeEventListener?.("abort", abortHandler);
  }
}

export async function readResponsePrefix(response: Response | undefined, signal: AbortSignal | undefined, maxBytes: number, timeoutMs: number): Promise<string> {
  const reader = response?.body?.getReader?.();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await readWithTimeout(
        reader,
        signal,
        timeoutMs,
        "Kiro retry error body stalled"
      );
      if (done) break;
      const remaining = maxBytes - totalBytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel("bounded Kiro retry error body").catch(() => {});
  }
  return decoder.decode(concatChunks(chunks, totalBytes));
}

export function appendRepairInstruction(body: Record<string, unknown>, kind: string): Record<string, unknown> {
  const repaired = structuredClone(body || {});
  const instruction = REPAIR_INSTRUCTIONS[kind as keyof typeof REPAIR_INSTRUCTIONS] || "Retry the previous incomplete Kiro response.";
  repaired.systemPrompt = repaired.systemPrompt
    ? `${repaired.systemPrompt}\n\n${instruction}`
    : instruction;
  return repaired;
}

export function normalizeStopReason(value: unknown): string | null {
  const reason = String(value || "").trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");
  if (["endturn", "end_turn", "stop", "stop_sequence"].includes(reason)) return "end_turn";
  if (["tooluse", "tool_use", "tool_calls"].includes(reason)) return "tool_use";
  if (["maxtokens", "max_tokens", "max_output_tokens", "length"].includes(reason)) return "max_tokens";
  return reason || null;
}

// Of the reasons stopDisposition() folds into "terminal_incomplete", only these
// mean "usable as far as it got, then the budget ran out" -- the case
// finish_reason "length" exists for. cancelled / pause_turn are abandoned turns
// whose partial content must stay private, so they are deliberately absent.
export const KIRO_TRUNCATION_STOP_REASONS = new Set(["model_context_window_exceeded", "max_tokens"]);

export function stopDisposition(stopReason: string | null, hasToolCalls: boolean): string {
  if (["malformed_model_output", "invalid_model_output"].includes(stopReason ?? "")) return "retryable_protocol_failure";
  if (["cancelled", "pause_turn", "model_context_window_exceeded"].includes(stopReason ?? "")) return "terminal_incomplete";
  if (stopReason === "refusal" || /(?:content.*filter|guardrail|safety|policy|blocked)/u.test(stopReason ?? "")) return "terminal_refusal";
  if (stopReason === "max_tokens") return hasToolCalls ? "terminal_incomplete" : "length";
  if (stopReason && !["end_turn", "tool_use"].includes(stopReason)) return "unknown_failure";
  if (hasToolCalls || stopReason === "tool_use") return "tool_use";
  if (!stopReason || stopReason === "end_turn") return "complete";
  return "unknown_failure";
}

export function mergeStopReason(current: string | null, incoming: string | null): string | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const severity = (reason: string | null): number => {
    const disposition = stopDisposition(reason, false);
    if (disposition === "terminal_refusal") return 6;
    if (disposition === "terminal_incomplete") return 5;
    if (disposition === "unknown_failure") return 4;
    if (disposition === "retryable_protocol_failure") return 3;
    if (disposition === "length") return 2;
    return 1;
  };
  return severity(incoming) > severity(current) ? incoming : current;
}

export function isEllipsisOnly(value: unknown): boolean {
  return ["...", "…"].includes(String(value || "").trim());
}

export function isShortFutureAction(value: unknown): boolean {
  const text = String(value || "").trim().replaceAll("\u2019", "'");
  if (OBSERVED_TRAILING_FUTURE_ACTION.test(text)) return true;
  if (ENGLISH_FUTURE_ACTION.test(text) && ENGLISH_RESULT_CLAUSE.test(text)) return false;
  if (CHINESE_FUTURE_ACTION.test(text) && CHINESE_RESULT_CLAUSE.test(text)) return false;
  return text.length > 0 && text.length <= KIRO_SHORT_FINAL_MAX_CHARS &&
    SHORT_FUTURE_ACTION.test(text) && !USER_WAIT.test(text) &&
    !COMPLETED_FINAL.test(text) && !RESULT_EVIDENCE.test(text);
}

export function encodeSSEError(code: string, message: string, details?: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ error: {
    message,
    type: "upstream_error",
    code,
    ...(details ? { details } : {})
  } })}\n\ndata: [DONE]\n\n`);
}

export function inspectSSEChunk(chunk: Uint8Array, state: InspectState): void {
  for (const line of decoder.decode(chunk).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      if (event.error) state.error = event.error as Record<string, unknown>;
      for (const choice of (event.choices || []) as Record<string, unknown>[]) {
        const delta = (choice.delta || {}) as Record<string, unknown>;
        if (typeof delta.content === "string") state.content += delta.content;
        if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
        if ((delta.tool_calls as unknown[])?.length) state.hasToolCalls = true;
      }
    } catch { /* a malformed SSE line is diagnosed by the transformer */ }
  }
}

// ── Transform helpers (extracted from transformEventStreamToSSE) ─────────────

export function makeDiagnostics(ctx: TransformContext, overrides: Record<string, unknown> = {}): SSEDiagnostics {
  return {
    terminal_provenance: ctx.state.terminalProvenance || "clean_eventstream_eof",
    transport_state: ctx.state.transportState,
    stop_reason: ctx.state.stopReason,
    stop_disposition: stopDisposition(ctx.state.stopReason, ctx.state.hasToolCalls),
    response_state: ctx.state.hasToolCalls
      ? "valid_tool"
      : ctx.state.hasText || ctx.state.hasReasoning || ctx.state.hasCode
        ? "text_reasoning"
        : ctx.state.explicitStop
          ? "explicit_stop"
          : "no_semantic_output",
    event_counts: { ...ctx.eventCounts },
    incomplete_frame_bytes: ctx.state.buffer.byteLength,
    ...overrides
  };
}

export function makeSseChunk(ctx: TransformContext, delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, number | string> | null): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({
    id: ctx.responseId,
    object: "chat.completion.chunk",
    created: ctx.created,
    model: ctx.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {})
  })}\n\n`);
}

export function emitDelta(ctx: TransformContext, controller: ReadableStreamDefaultController<Uint8Array>, delta: Record<string, unknown>): void {
  if (ctx.state.chunkIndex === 0) delta = { role: "assistant", ...delta };
  ctx.state.chunkIndex++;
  controller.enqueue(makeSseChunk(ctx, delta));
}

export function failTransform(ctx: TransformContext, controller: ReadableStreamDefaultController<Uint8Array>, provenance: string, code: string, message: string, extra: Record<string, unknown> = {}): void {
  ctx.state.finished = true;
  ctx.state.terminalProvenance = provenance;
  ctx.state.transportState = (extra.transport_state as string) || "corrupt_frame";
  const detail = makeDiagnostics(ctx, {
    stop_disposition: extra.stop_disposition || "terminal_incomplete",
    ...extra
  });
  ctx.options.onTerminalState?.(detail);
  controller.enqueue(encodeSSEError(code, message, detail));
}

function assertToolBufferBound(ctx: TransformContext): void {
  if (ctx.state.bufferedToolBytes <= (ctx.options.maxToolBytes || KIRO_REPAIR_BUFFER_MAX_BYTES / 2)) return;
  const error = new Error("Kiro buffered tool input exceeded the integrity memory bound") as Error & { code?: string };
  error.code = "KIRO_BUFFER_EXCEEDED";
  throw error;
}

function appendToolInput(tool: ToolEntry, input: unknown, ctx: TransformContext): void {
  if (input === undefined) return;
  if (typeof input === "string") {
    if (tool.inputKind && tool.inputKind !== "string") throw new Error("Kiro tool input changed fragment type");
    tool.inputKind = "string";
    tool.inputChunks ||= [];
    tool.inputChunks.push(input);
    ctx.state.bufferedToolBytes += encoder.encode(input).byteLength;
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    if (tool.inputKind && tool.inputKind !== "object") throw new Error("Kiro tool input changed fragment type");
    tool.inputKind = "object";
    ctx.state.bufferedToolBytes -= tool.inputBytes || 0;
    tool.inputObject = input;
    tool.inputBytes = encoder.encode(JSON.stringify(input)).byteLength;
    ctx.state.bufferedToolBytes += tool.inputBytes;
  } else {
    throw new Error("Kiro tool input must be a JSON object");
  }
  assertToolBufferBound(ctx);
}

function parsedToolInput(tool: ToolEntry): unknown {
  if (!tool.inputKind) throw new Error("Kiro tool call is missing input");
  if (tool.inputKind === "object") return tool.inputObject;
  try {
    const input = JSON.parse(tool.inputChunks!.join(""));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("not an object");
    return input;
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    throw new Error(`Kiro tool input must be valid object JSON (${error.message})`);
  }
}

export function emitTools(ctx: TransformContext, controller: ReadableStreamDefaultController<Uint8Array>): void {
  for (const tool of ctx.state.tools.values()) {
    // Validate per tool, not per turn: one unusable fragment used to throw out
    // of emitTools and take every other complete tool call in the same turn
    // with it, which the client saw as a turn that answered nothing.
    let input: unknown;
    try {
      input = parsedToolInput(tool);
      if (tool.name === "tool_call") {
        if (typeof (input as Record<string, unknown>).name !== "string" || !((input as Record<string, unknown>).name as string).trim()) {
          throw new Error("Invalid Kiro tool_call payload: missing nested MCP tool name");
        }
        if (!Object.prototype.hasOwnProperty.call(input, "arguments")) {
          throw new Error("Invalid Kiro tool_call payload: missing nested MCP tool arguments");
        }
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      ctx.state.droppedTools = (ctx.state.droppedTools || 0) + 1;
      ctx.state.toolValidationError ||= error.message;
      console.error(`[Kiro] dropping unusable tool call ${tool.id} (${tool.name}): ${error.message}`);
      continue;
    }
    const index = ctx.state.toolCounter++;
    emitDelta(ctx, controller, {
      tool_calls: [{
        index,
        id: tool.id,
        type: "function",
        function: { name: tool.name, arguments: "" }
      }]
    });
    const serializedInput = JSON.stringify(input);
    emitDelta(ctx, controller, {
      tool_calls: [{ index, function: { arguments: serializedInput } }]
    });
    // Tool arguments are billed output like any other completion bytes. They
    // were never added to totalContentLength, so the /4 estimator in finish()
    // reported OUT 0 -- or the Math.max floor of 1 -- for every turn whose
    // entire answer was a tool call.
    ctx.state.totalContentLength += tool.name.length + serializedInput.length;
    ctx.state.hasToolCalls = true;
  }
  ctx.state.tools.clear();
  ctx.state.bufferedToolBytes = 0;
  // A declared tool turn that emitted no usable call is only fatal when the
  // turn produced nothing else. Throwing unconditionally here escaped
  // emitTools() with provenance "invalid_tool_call", which the integrity gate
  // re-derived into a repair retry -- discarding text the client had already
  // been promised.
  if (ctx.state.stopReason === "tool_use" && !ctx.state.hasToolCalls &&
      !ctx.state.hasText && !ctx.state.hasReasoning && !ctx.state.hasCode) {
    throw new Error("Kiro tool_use stop reason did not include a complete tool call");
  }
}

export function handleAssistantResponseEvent(event: EventFrame, controller: ReadableStreamDefaultController<Uint8Array>, ctx: TransformContext): void {
  if (typeof event.payload?.content !== "string") return;
  let content = event.payload.content;
  if (ctx.state.inThinking) {
    const end = content.indexOf("</thinking>");
    if (end < 0) content = "";
    else {
      ctx.state.inThinking = false;
      content = content.slice(end + 11).replace(/^\n/u, "");
    }
  } else {
    const start = content.indexOf("<thinking>");
    if (start >= 0) {
      const end = content.indexOf("</thinking>", start + 10);
      if (end < 0) {
        ctx.state.inThinking = true;
        content = content.slice(0, start);
      } else {
        content = content.slice(0, start) + content.slice(end + 11).replace(/^\n/u, "");
      }
    }
  }
  if (content || !ctx.state.hasReasoning) {
    ctx.state.hasText ||= content.length > 0;
    ctx.state.totalContentLength += content.length;
    emitDelta(ctx, controller, { content });
  }
}

export function handleToolUseEvent(event: EventFrame, controller: ReadableStreamDefaultController<Uint8Array>, ctx: TransformContext): void {
  ctx.state.sawToolUse = true;
  const values = Array.isArray(event.payload) ? event.payload : [event.payload];
  if (!values[0]) throw new Error("Kiro toolUseEvent is empty");
  for (const value of values as Record<string, unknown>[]) {
    const name = typeof value?.name === "string" ? (value.name as string).trim() : "";
    if (!name) throw new Error("Kiro toolUseEvent is missing a tool name");
    let id: string;
    if (value.toolUseId == null) {
      id = `call_${ctx.created}_${ctx.state.tools.size + 1}`;
    } else if (typeof value.toolUseId !== "string" || !(value.toolUseId as string).trim()) {
      throw new Error("Kiro toolUseEvent has an invalid toolUseId");
    } else {
      id = value.toolUseId as string;
    }
    let tool = ctx.state.tools.get(id);
    if (!tool) {
      tool = { id, name };
      ctx.state.tools.set(id, tool);
      ctx.state.bufferedToolBytes += encoder.encode(id).byteLength + encoder.encode(name).byteLength + 32;
      assertToolBufferBound(ctx);
    } else if (tool.name !== name) {
      throw new Error("Kiro tool name changed between fragments");
    }
    appendToolInput(tool, value.input, ctx);
  }
}

export function handleMetricsEvent(event: EventFrame, ctx: TransformContext): void {
  const metrics = (event.payload?.metricsEvent || event.payload || {}) as Record<string, unknown>;
  const prompt = Number(metrics.inputTokens) || 0;
  const completion = Number(metrics.outputTokens) || 0;
  if (prompt || completion) {
    ctx.state.usage = {
      ...(ctx.state.usage || {}),
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion
    };
    const cacheRead = Number(metrics.cacheReadInputTokens || metrics.cache_read_input_tokens) || 0;
    const cacheCreate = Number(metrics.cacheCreationInputTokens || metrics.cache_creation_input_tokens) || 0;
    if (cacheRead) ctx.state.usage.cache_read_input_tokens = cacheRead;
    if (cacheCreate) ctx.state.usage.cache_creation_input_tokens = cacheCreate;
  }
}



