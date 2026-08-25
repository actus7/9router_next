import { err } from "../logger";
import { IS_DEV } from "../config";
import { fetchRouter, pipeTransformedEventStream } from "./base";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type http from "http";

// Debug trace log — written to data/logs/mitm/kiro-debug.log (dev only)
const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
const DEBUG_LOG: string = path.join(__dirname, "../../../data/logs/mitm/kiro-debug.log");
function dbg(msg: string): void {
  if (!IS_DEV) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

// ─── CRC32 (standard, polynomial 0xEDB88320 — same as AWS EventStream) ───────
const CRC32_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc: number = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface KiroState {
  modelId: string | null;
  toolCallInit: Record<number, { id: string; name: string }>;
  hasToolCalls: boolean;
  finishSent: boolean;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
  inThink: boolean;
  thinkBuf: string;
  initialSent: boolean;
}

/**
 * Initialize state for the Kiro response translator
 */
function initKiroState(modelId: string | null): KiroState {
  return {
    modelId: modelId || null,
    toolCallInit: {},
    hasToolCalls: false,
    finishSent: false,
    usage: null,
    inThink: false,
    thinkBuf: "",
    initialSent: false,
  };
}

interface ThinkingResult {
  thinking: string | null;
  text: string | null;
}

/**
 * Extract thinking blocks from text content.
 * Handles both <thinking>...</thinking> and <think>...</think> tags,
 * including partial tags split across SSE chunks.
 */
function extractThinking(text: string | null, state: { inThink: boolean; thinkBuf: string }): ThinkingResult {
  if (!text) return { thinking: null, text: null };

  let working: string = text;

  // Prepend buffered partial thinking from previous chunk
  if (state.inThink && state.thinkBuf) {
    working = state.thinkBuf + working;
    state.thinkBuf = "";
    state.inThink = false;
  }

  // Match <thinking> or <think> opening tags
  const startRe: RegExp = /<thinking>|<think>/i;
  const startMatch: RegExpMatchArray | null = working.match(startRe);

  if (!startMatch) {
    return { thinking: null, text: working };
  }

  const tag: string = startMatch[0].toLowerCase();
  const closeTag: string = tag === "<think>" ? "</think>" : "</thinking>";
  const startIdx: number = startMatch.index!;
  const endIdx: number = working.indexOf(closeTag, startIdx + tag.length);

  if (endIdx === -1) {
    // Opening tag without closing — buffer for next chunk
    state.inThink = true;
    state.thinkBuf = working.slice(startIdx);
    const before: string = working.slice(0, startIdx).trim();
    return { thinking: null, text: before || null };
  }

  // Complete block found
  const thinking: string = working.slice(startIdx + tag.length, endIdx);
  const before: string = working.slice(0, startIdx).trim();
  const after: string = working.slice(endIdx + closeTag.length).trim();
  const rest: string = [before, after].filter(Boolean).join("");

  // Recursively process for more blocks
  const recurse: ThinkingResult = rest
    ? extractThinking(rest, { inThink: false, thinkBuf: "" })
    : { thinking: null, text: null };

  return {
    thinking: thinking || null,
    text: recurse.text || null
  };
}

// ─── AWS EventStream frame builder ────────────────────────────────────────────
/**
 * Encode a single string header into the AWS EventStream binary format.
 * Header wire format: [nameLen 1B][name][type=7 1B][valueLen 2B][value]
 */
function encodeHeader(name: string, value: string): Buffer {
  const nameBuf: Buffer = Buffer.from(name, "utf8");
  const valueBuf: Buffer = Buffer.from(value, "utf8");
  const buf: Buffer = Buffer.alloc(1 + nameBuf.length + 1 + 2 + valueBuf.length);
  let o: number = 0;
  buf[o++] = nameBuf.length;
  nameBuf.copy(buf, o); o += nameBuf.length;
  buf[o++] = 7; // string type
  buf.writeUInt16BE(valueBuf.length, o); o += 2;
  valueBuf.copy(buf, o);
  return buf;
}

/**
 * Build a single AWS EventStream binary frame with all Smithy-required headers.
 */
function buildEventStreamFrame(eventType: string, payload: Record<string, unknown> | string, contentType: string = "application/json"): Buffer {
  const payloadBuf: Buffer = Buffer.from(
    typeof payload === "string" ? payload : JSON.stringify(payload),
    "utf8"
  );

  // All three Smithy system headers are required
  const headersBuf: Buffer = Buffer.concat([
    encodeHeader(":message-type", "event"),
    encodeHeader(":event-type", eventType),
    encodeHeader(":content-type", contentType),
  ]);
  const headersLen: number = headersBuf.length;

  const totalLen: number = 4 + 4 + 4 + headersLen + payloadBuf.length + 4;
  const frame: Buffer = Buffer.alloc(totalLen);

  frame.writeUInt32BE(totalLen, 0);
  frame.writeUInt32BE(headersLen, 4);
  frame.writeUInt32BE(crc32(frame.slice(0, 8)), 8); // prelude CRC
  headersBuf.copy(frame, 12);
  payloadBuf.copy(frame, 12 + headersLen);
  frame.writeUInt32BE(crc32(frame.slice(0, totalLen - 4)), totalLen - 4); // message CRC

  return frame;
}

/** Real Kiro Runtime always starts the stream with this frame (capture of IDE 1.0.228). */
function buildInitialResponseFrame(conversationId: string = ""): Buffer {
  return buildEventStreamFrame(
    "initial-response",
    { conversationId: conversationId || "" },
    "application/x-amz-json-1.0"
  );
}

/** Prepend initial-response once per stream so Smithy decoder is happy. */
function withInitialFrame(state: KiroState, frames: Buffer | Buffer[] | null): Buffer | Buffer[] | null {
  const list: Buffer[] = frames == null ? [] : Array.isArray(frames) ? frames : [frames];
  if (state.initialSent) return list.length === 0 ? null : list.length === 1 ? list[0] : list;
  state.initialSent = true;
  const out: Buffer[] = [buildInitialResponseFrame(""), ...list];
  return out.length === 1 ? out[0] : out;
}

// ─── CodeWhisperer → OpenAI conversion ───────────────────────────────────────

/**
 * Safely stringify a tool-call input value.
 */
function safeArgsString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "{}";
  try { return JSON.stringify(value); } catch { return "{}"; }
}

interface OpenAIMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

/**
 * Convert a CodeWhisperer userInputMessage to one or more OpenAI messages.
 */
function convertUserInputMessage(uim: any): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  const toolResults: any[] = uim.userInputMessageContext?.toolResults || [];

  for (const tr of toolResults) {
    const text: string = (tr.content || []).map((c: any) => c.text || "").join("\n");
    out.push({
      role: "tool",
      tool_call_id: tr.toolUseId || "",
      content: text,
    });
  }

  const text: string = (uim.content || "").trim();
  if (text || toolResults.length === 0) {
    out.push({ role: "user", content: text });
  }

  return out;
}

/**
 * Convert a CodeWhisperer assistantResponseMessage to an OpenAI assistant message.
 */
function convertAssistantResponseMessage(arm: any): OpenAIMessage {
  const toolUses: any[] = arm.toolUses || [];

  if (toolUses.length > 0) {
    return {
      role: "assistant",
      content: arm.content || null,
      tool_calls: toolUses.map((tu: any) => ({
        id: tu.toolUseId || `call_${Date.now()}`,
        type: "function",
        function: {
          name: tu.name || "",
          arguments: safeArgsString(tu.input),
        },
      })),
    };
  }

  return { role: "assistant", content: arm.content || "" };
}

/**
 * Convert AWS CodeWhisperer conversationState to an OpenAI messages array.
 */
function codeWhispererToMessages(body: any): OpenAIMessage[] {
  const cs: any = body.conversationState || {};
  const history: any[] = cs.history || [];
  const currentMsg: any = cs.currentMessage;
  const messages: OpenAIMessage[] = [];

  for (const item of history) {
    if (item.userInputMessage) {
      messages.push(...convertUserInputMessage(item.userInputMessage));
    } else if (item.assistantResponseMessage) {
      messages.push(convertAssistantResponseMessage(item.assistantResponseMessage));
    }
  }

  if (currentMsg?.userInputMessage) {
    messages.push(...convertUserInputMessage(currentMsg.userInputMessage));
  }

  return messages;
}

interface OpenAITool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Extract tool definitions from a CodeWhisperer request and convert to OpenAI format.
 */
function extractTools(body: any): OpenAITool[] {
  const cs: any = body.conversationState || {};

  const fromCurrent: any[] = cs.currentMessage?.userInputMessage?.userInputMessageContext?.tools || [];
  const fromHistory: any[] = cs.history?.find((h: any) => h.userInputMessage?.userInputMessageContext?.tools)
    ?.userInputMessage?.userInputMessageContext?.tools || [];
  const cwTools: any[] = fromCurrent.length > 0 ? fromCurrent : fromHistory;

  if (!cwTools.length) return [];

  return cwTools.map((item: any) => {
    const spec: any = item.toolSpecification || item;
    return {
      type: "function",
      function: {
        name: spec.name || "",
        description: spec.description || `Tool: ${spec.name || "unknown"}`,
        parameters: spec.inputSchema?.json || { type: "object", properties: {}, required: [] },
      },
    };
  });
}

// ─── OpenAI SSE → EventStream binary conversion ───────────────────────────────

/**
 * Convert an OpenAI SSE chunk to AWS EventStream binary frame(s)
 */
function convertOpenAIToKiro(chunk: Record<string, unknown> | null, state: Record<string, unknown>): Uint8Array | Uint8Array[] | null {
  const s = state as unknown as KiroState;

  // Flush: ensure clean stream termination
  if (!chunk) {
    if (s.finishSent) return null;
    // Flush any remaining buffered thinking
    if (s.inThink && s.thinkBuf) {
      s.inThink = false;
      const thinking: string = s.thinkBuf;
      s.thinkBuf = "";
      return withInitialFrame(s, buildEventStreamFrame("reasoningContentEvent", {
        content: thinking,
        modelId: s.modelId || "kiro-unknown"
      })) as Uint8Array | Uint8Array[] | null;
    }
    return withInitialFrame(s, buildEventStreamFrame("messageStopEvent", {})) as Uint8Array | Uint8Array[] | null;
  }

  const frames: Buffer[] = [];
  const choice: any = (chunk as any).choices?.[0];
  const delta: any = choice?.delta || {};

  // Capture modelId from first chunk
  if (!s.modelId && (chunk as any).model) {
    s.modelId = (chunk as any).model;
  }
  const modelId: string = s.modelId || "unknown";

  // Handle usage
  if ((chunk as any).usage) {
    s.usage = (chunk as any).usage;
  }

  // Handle tool calls
  if (delta.tool_calls) {
    s.hasToolCalls = true;
    for (const tc of delta.tool_calls) {
      const idx: number = tc.index ?? 0;

      if (tc.id && tc.function?.name && !s.toolCallInit[idx]) {
        s.toolCallInit[idx] = { id: tc.id, name: tc.function.name };
        dbg(`toolUseEvent init: ${tc.function.name} (${tc.id})`);
        frames.push(buildEventStreamFrame("toolUseEvent", {
          name: tc.function.name,
          toolUseId: tc.id
        }));
      }

      if (tc.function?.arguments) {
        const init = s.toolCallInit[idx];
        dbg(`toolUseEvent fragment: ${tc.function.arguments.slice(0, 100)}`);
        frames.push(buildEventStreamFrame("toolUseEvent", {
          input: tc.function.arguments,
          name: init?.name || tc.function?.name || "",
          toolUseId: init?.id || tc.id || ""
        }));
      }
    }
  }

  // Handle explicit reasoning_content
  if (delta.reasoning_content) {
    frames.push(buildEventStreamFrame("reasoningContentEvent", {
      content: delta.reasoning_content,
      modelId
    }));
  }

  // Handle text content
  if (delta.content) {
    const { thinking, text } = extractThinking(delta.content, s);

    if (thinking) {
      frames.push(buildEventStreamFrame("reasoningContentEvent", {
        content: thinking,
        modelId
      }));
    }

    if (text) {
      frames.push(buildEventStreamFrame("assistantResponseEvent", {
        content: text,
        modelId
      }));
    }
  }

  // Handle finish_reason
  if (choice?.finish_reason) {
    const finishFrames = emitFinish(s);
    if (finishFrames) {
      frames.push(...(Array.isArray(finishFrames) ? finishFrames : [finishFrames]));
    }
  }

  if (frames.length === 0) {
    if (!s.initialSent) return withInitialFrame(s, null) as Uint8Array | Uint8Array[] | null;
    return null;
  }
  return withInitialFrame(s, frames.length === 1 ? frames[0] : frames) as Uint8Array | Uint8Array[] | null;
}

/**
 * Emit termination frames.
 */
function emitFinish(state: KiroState): Buffer[] | null {
  const frames: Buffer[] = [];

  if (state.hasToolCalls) {
    for (const idx of Object.keys(state.toolCallInit).sort()) {
      const tc = state.toolCallInit[Number(idx)];
      frames.push(buildEventStreamFrame("toolUseEvent", {
        name: tc.name,
        stop: true,
        toolUseId: tc.id
      }));
    }
  } else {
    frames.push(buildEventStreamFrame("messageStopEvent", {}));
  }
  state.finishSent = true;

  if (state.usage) {
    frames.push(buildEventStreamFrame("usageEvent", {
      inputTokens: state.usage.prompt_tokens || 0,
      outputTokens: state.usage.completion_tokens || 0
    }));
  }

  state.toolCallInit = {};
  return frames.length > 0 ? frames : null;
}

// ─── MITM intercept entry point ───────────────────────────────────────────────

/**
 * Intercept Kiro IDE CodeWhisperer request and convert to EventStream response.
 */
async function intercept(req: http.IncomingMessage, res: http.ServerResponse, bodyBuffer: Buffer, mappedModel: string): Promise<void> {
  try {
    if (isBinaryEventStream(bodyBuffer)) {
      throw new Error(`Binary EventStream format detected (${bodyBuffer.length}B) - request should use passthrough instead of intercept`);
    }
    
    const body: any = JSON.parse(bodyBuffer.toString());

    const messages: OpenAIMessage[] = codeWhispererToMessages(body);
    if (messages.length === 0) {
      throw new Error("codeWhispererToMessages produced 0 messages — check request body");
    }

    const tools: OpenAITool[] = extractTools(body);

    const openaiBody: Record<string, unknown> = {
      model: mappedModel,
      messages,
      stream: true,
      ...(tools.length > 0 && { tools, tool_choice: "auto" }),
    };

    const routerRes: Response = await fetchRouter(openaiBody, "/v1/chat/completions", req.headers as Record<string, string | string[] | undefined>);

    const state: KiroState = initKiroState(mappedModel);

    await pipeTransformedEventStream(routerRes, res, convertOpenAIToKiro, state as unknown as Record<string, unknown>);
  } catch (error: any) {
    err(`[Kiro MITM] Request processing failed: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ 
      error: { 
        message: error.message, 
        type: "mitm_error",
        handler: "kiro"
      } 
    }));
  }
}

// Detect AWS EventStream binary format
function isBinaryEventStream(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) return false;
  const totalLen: number = buffer.readUInt32BE(0);
  const headersLen: number = buffer.readUInt32BE(4);
  return totalLen > 12 && totalLen < 1000000 && headersLen < totalLen - 12;
}

export { intercept };
