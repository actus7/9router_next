import zlib from "zlib";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { extractTextFromResponse } from "../utils/cursorProtobuf";
import { chatChunkSse } from "../utils/sse";

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03,
};

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1";
export const debugLog = (...args: unknown[]) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args);
};

export function isComposerModel(model: string) {
  const modelId = String(model || "").split("/").pop() ?? "";
  return /^composer(?:-|$)/i.test(modelId);
}

export function visibleComposerContentFromThinking(thinking: string) {
  if (!thinking) return "";
  const endTag = "</think>";
  const endIdx = thinking.lastIndexOf(endTag);
  if (endIdx < 0) return "";
  return thinking.slice(endIdx + endTag.length).trimStart();
}

function decompressPayload(payload: Buffer<ArrayBufferLike>, flags: number) {
  // Check if payload is JSON error (starts with {"error")
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    try {
      const text = payload.toString("utf-8");
      if (text.startsWith('{"error"')) {
        debugLog(`[DECOMPRESS] Detected JSON error, skipping decompression`);
        return payload;
      }
    } catch {}
  }

  if (
    flags === COMPRESS_FLAG.GZIP ||
    flags === COMPRESS_FLAG.TRAILER ||
    flags === COMPRESS_FLAG.GZIP_TRAILER
  ) {
    // Primary: try gzip decompression (standard gzip header 0x1f 0x8b)
    try {
      return zlib.gunzipSync(payload);
    } catch (gzipErr: unknown) {
      // Fallback: TRAILER and GZIP_TRAILER frames sometimes use raw zlib deflate format
      try {
        return zlib.inflateSync(payload);
      } catch (deflateErr: unknown) {
        // Last resort: try raw deflate (no zlib header)
        try {
          return zlib.inflateRawSync(payload);
        } catch (rawErr: unknown) {
          const gzipMsg = gzipErr instanceof Error ? gzipErr.message : String(gzipErr);
          const deflateMsg = deflateErr instanceof Error ? deflateErr.message : String(deflateErr);
          const rawMsg = rawErr instanceof Error ? rawErr.message : String(rawErr);
          debugLog(
            `[DECOMPRESS ERROR] flags=${flags}, payloadSize=${payload.length}, gzip=${gzipMsg}, deflate=${deflateMsg}, raw=${rawMsg}`
          );
          debugLog(
            `[DECOMPRESS ERROR] First 50 bytes (hex):`,
            payload.slice(0, 50).toString("hex")
          );
          return payload;
        }
      }
    }
  }
  return payload;
}

// Read one cursor protobuf frame: header + bounds + decompress. Returns status + payload + new offset.
export function readCursorFrame(buffer: Buffer<ArrayBufferLike>, offset: number, frameNum: number, tag: string) {
  if (offset + 5 > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Reached end, offset=${offset}, remaining=${buffer.length - offset}`);
    return { status: "done" };
  }

  const flags = buffer[offset];
  const length = buffer.readUInt32BE(offset + 1);
  debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`);

  if (offset + 5 + length > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`);
    return { status: "done" };
  }

  let payload: Buffer<ArrayBufferLike> = buffer.slice(offset + 5, offset + 5 + length);
  const newOffset = offset + 5 + length;
  payload = decompressPayload(payload, flags) as Buffer<ArrayBufferLike>;
  if (!payload) {
    debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: decompression failed, skipping`);
    return { status: "skip", offset: newOffset };
  }
  return { status: "ok", payload, offset: newOffset };
}

export function createErrorResponse(jsonError: Record<string, unknown>) {
  const err = jsonError?.error as Record<string, unknown> | undefined;
  const details = err?.details as Record<string, unknown>[] | undefined;
  const debug = details?.[0]?.debug as Record<string, unknown> | undefined;
  const debugDetails = debug?.details as Record<string, unknown> | undefined;
  const errorMsg = (debugDetails?.title as string)
    || (debugDetails?.detail as string)
    || (err?.message as string)
    || "API Error";
  
  const isRateLimit = err?.code === "resource_exhausted";
  
  return new Response(JSON.stringify({
    error: {
      message: errorMsg,
      type: isRateLimit ? "rate_limit_error" : "api_error",
      code: (debug?.error as string) || "unknown"
    }
  }), {
    status: isRateLimit ? HTTP_STATUS.RATE_LIMITED : HTTP_STATUS.BAD_REQUEST,
    headers: { "Content-Type": "application/json" }
  });
}

type CursorToolCall = NonNullable<ReturnType<typeof extractTextFromResponse>["toolCall"]> & {
  index?: number;
};

export interface SseFrameState {
  chunks: string[];
  totalContent: string;
  totalThinking: string;
  emittedComposerThinkingContentLength: number;
  toolCalls: CursorToolCall[];
  toolCallsMap: Map<string, CursorToolCall>;
  finalizedIds: Set<string>;
  emittedToolCallIds: Set<string>;
  responseId: string;
  created: number;
  model: string;
}

type SseFrameResult =
  | { action: "continue" }
  | { action: "break" }
  | { action: "return"; response: Response };

function emitToolCallChunks(state: SseFrameState, tc: CursorToolCall): void {
  if (state.chunks.length === 0) {
    state.chunks.push(chatChunkSse({ id: state.responseId, created: state.created, model: state.model, delta: { role: "assistant", content: "" } }));
  }

  if (state.toolCallsMap.has(tc.id)) {
    const existing = state.toolCallsMap.get(tc.id)!;
        existing.function.arguments += tc.function.arguments;
    existing.isLast = tc.isLast;

    if (tc.function.arguments) {
      state.emittedToolCallIds.add(tc.id);
      state.chunks.push(chatChunkSse({
        id: state.responseId, created: state.created, model: state.model,
        delta: {
          tool_calls: [
            {
              index: existing.index,
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
  } else {
    const toolCallIndex: number = state.toolCalls.length;
    state.finalizedIds.add(tc.id);
    state.toolCalls.push({ ...tc, index: toolCallIndex });
    state.toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex });

    state.emittedToolCallIds.add(tc.id);
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

export function processSseFrame(state: SseFrameState, payload: Buffer<ArrayBufferLike>, frameCount: number): SseFrameResult {
  // Check for JSON error frames (byte-guard: only decode if starts with '{')
  if (payload[0] === 0x7b) {
    try {
      const text = payload.toString("utf-8");
      if (text.includes('"error"')) {
        const hasContent = state.chunks.length > 0 || state.totalContent || state.toolCallsMap.size > 0;
        debugLog(
          `[CURSOR BUFFER SSE] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
        );
        if (hasContent) {
          return { action: "break" };
        }
        return { action: "return", response: createErrorResponse(JSON.parse(text)) };
      }
    } catch {}
  }

  const result = extractTextFromResponse(new Uint8Array(payload) as Uint8Array<ArrayBuffer>);
  debugLog(`[CURSOR DECODED SSE] Frame ${frameCount}:`, result);

  if (result.error) {
    const hasContent = state.chunks.length > 0 || state.totalContent || state.toolCallsMap.size > 0;
    debugLog(`[CURSOR BUFFER SSE] Decoded error (hasContent=${hasContent}): ${result.error}`);
    if (hasContent) {
      return { action: "break" };
    }
    return {
      action: "return",
      response: new Response(
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
      )
    };
  }

  if (result.toolCall) {
    emitToolCallChunks(state, result.toolCall);
  }

  if (result.text) {
    state.totalContent += result.text;
    state.chunks.push(chatChunkSse({
      id: state.responseId, created: state.created, model: state.model,
      delta:
        state.chunks.length === 0 && state.toolCalls.length === 0
          ? { role: "assistant", content: result.text }
          : { content: result.text }
    }));
  }

  if (isComposerModel(state.model) && result.thinking) {
    state.totalThinking += result.thinking;
    const visibleContent = visibleComposerContentFromThinking(state.totalThinking);
    if (visibleContent.length > state.emittedComposerThinkingContentLength) {
      const deltaContent = visibleContent.slice(state.emittedComposerThinkingContentLength);
      state.emittedComposerThinkingContentLength = visibleContent.length;
      state.totalContent += deltaContent;
      state.chunks.push(chatChunkSse({
        id: state.responseId, created: state.created, model: state.model,
        delta:
          state.chunks.length === 0 && state.toolCalls.length === 0
            ? { role: "assistant", content: deltaContent }
            : { content: deltaContent }
      }));
    }
  }

  return { action: "continue" };
}

export function setupHttp2Request(
  client: ReturnType<typeof import("http2").connect>,
  urlObj: URL,
  headers: Record<string, string>,
  state: { ended: boolean; streamError: Error | null },
  wake: (result: { value: Buffer | undefined; done: boolean } | null) => void,
  chunkQueue: Buffer[]
) {
  const req = client.request({
    ":method": "POST",
    ":path": urlObj.pathname,
    ":authority": urlObj.host,
    ":scheme": "https",
    ...headers,
  });

  req.on("error", (error: Error) => {
    if (state.streamError) return;
    state.streamError = error;
    state.ended = true;
    wake(null);
  });
  req.on("data", (chunk) => {
    if (chunkQueue.length > 0 || state.ended) return;
    chunkQueue.push(chunk);
  });
  req.on("end", () => {
    state.ended = true;
    wake({ value: undefined, done: true });
  });

  return req;
}

