import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import {
  type DuckAiSseEvent,
  DuckAiRetryableError,
  buildDuckAiErrorResponse,
  encodeDuckAiChunk,
  isJson,
} from "./duckaiRuntime";

async function emitDuckAiRemainingChunks(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  cid: string,
  created: number,
  model: string,
  rawChunks: string[]
) {
  for (const rc of rawChunks) {
    const ev = createDuckAiStreamEvent(rc);
    if (!ev || ev.kind === "error") continue;
    if (ev.content) {
      await writer.write(encodeDuckAiChunk(encoder, cid, created, model, { content: ev.content }));
    }
  }
}

async function readUpstreamDuckAiChunks(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  cid: string,
  created: number,
  model: string,
  signal: AbortSignal | undefined,
  upstreamReader: ReadableStreamDefaultReader<Uint8Array>,
  upstreamBuffer: string
) {
  const upstreamDecoder = new TextDecoder();
  let buf = upstreamBuffer;
  while (true) {
    if (signal?.aborted) break;
    const { done: d, value: v } = await upstreamReader.read();
    if (d) {
      const fc = extractDuckAiSseChunks(buf, true).chunks;
      await emitDuckAiRemainingChunks(writer, encoder, cid, created, model, fc);
      break;
    }
    buf += upstreamDecoder.decode(v, { stream: true });
    const ext = extractDuckAiSseChunks(buf);
    buf = ext.rest;
    await emitDuckAiRemainingChunks(writer, encoder, cid, created, model, ext.chunks);
  }
}

/**
 * Pump Duck.ai SSE content into a WritableStream writer.
 *
 * Emits: role chunk → content chunks → finish chunk → DONE.
 * On error: emits error chunk → DONE.
 * Optionally continues reading from an upstream reader after exhausting
 * the initial `remainingRawChunks`.
 */
async function pumpDuckAiStreamToWriter(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  cid: string,
  created: number,
  model: string,
  signal: AbortSignal | undefined,
  firstContent: string,
  remainingRawChunks: string[],
  upstreamReader?: ReadableStreamDefaultReader<Uint8Array>,
  upstreamBuffer?: string
): Promise<void> {
  try {
    await writer.write(encodeDuckAiChunk(encoder, cid, created, model, { role: "assistant" }));
    await writer.write(encodeDuckAiChunk(encoder, cid, created, model, { content: firstContent }));
    await emitDuckAiRemainingChunks(writer, encoder, cid, created, model, remainingRawChunks);

    if (upstreamReader) {
      await readUpstreamDuckAiChunks(writer, encoder, cid, created, model, signal, upstreamReader, upstreamBuffer ?? "");
    }

    await writer.write(encodeDuckAiChunk(encoder, cid, created, model, {}, "stop"));
    await writer.write(encoder.encode(SSE_DONE));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await writer
      .write(encodeDuckAiChunk(encoder, cid, created, model, { content: `[Stream error: ${errorMsg}]` }, "stop"))
      .catch(() => {});
    await writer.write(encoder.encode(SSE_DONE)).catch(() => {});
  } finally {
    await writer.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

function createDuckAiStreamEvent(rawChunk: string): DuckAiSseEvent | null {
  const json = rawChunk.replace(/^data:\s*/, "");
  if (!isJson(json)) return null;

  const parsed = JSON.parse(json) as {
    action?: string;
    content?: string;
    message?: string;
    overrideCode?: string;
    role?: string;
    type?: string;
  };

  if (parsed.action === "error") {
    const message = parsed.type ?? parsed.message ?? "Duck.ai stream returned an error event";
    const retryClass =
      parsed.type === "ERR_BN_LIMIT" || message.includes("ERR_BN_LIMIT")
        ? "bn_limit"
        : parsed.type === "ERR_CHALLENGE" || message.includes("ERR_CHALLENGE")
          ? "challenge"
          : undefined;
    return {
      kind: "error",
      message,
      overrideCode: parsed.overrideCode,
      retryClass,
      type: parsed.type,
    };
  }

  const content =
    typeof parsed.message === "string"
      ? parsed.message
      : parsed.role === "assistant" && typeof parsed.content === "string"
        ? parsed.content
        : "";

  return content ? { content, kind: "content" } : null;
}

function extractDuckAiSseChunks(
  buffer: string,
  flush = false
): { chunks: string[]; rest: string } {
  if (flush) {
    const finalChunk = buffer.trim();
    return { chunks: finalChunk ? [finalChunk] : [], rest: "" };
  }

  const parts = buffer.split("\n\n");
  return {
    chunks: parts.slice(0, -1).filter((part) => part.startsWith("data: ")),
    rest: parts.at(-1) ?? "",
  };
}

// ---------------------------------------------------------------------------
// Chat request building
// ---------------------------------------------------------------------------

type PrimedDuckAiStreamResult =
  | { response: Response }
  | { retryableError: DuckAiRetryableError }
  | { errorResponse: Response };

function classifyDuckAiStreamError(
  event: DuckAiSseEvent & { kind: "error" }
): PrimedDuckAiStreamResult {
  if (event.retryClass) {
    return {
      retryableError: new DuckAiRetryableError(event.message, {
        overrideCode: event.overrideCode,
        phase: "chat_stream_prelude",
        retryClass: event.retryClass,
        type: event.type,
      }),
    };
  }

  return {
    errorResponse: buildDuckAiErrorResponse(502, {
      message: event.message,
      type: "upstream_error",
      code: "DUCKAI_STREAM_ERROR",
      overrideCode: event.overrideCode,
      upstreamType: event.type,
    }),
  };
}

export async function primeDuckAiStream(
  chatResponse: Response,
  model: string,
  cid: string,
  created: number,
  signal?: AbortSignal
): Promise<PrimedDuckAiStreamResult> {
  if (!chatResponse.body) {
    return {
      errorResponse: buildDuckAiErrorResponse(502, {
        message: "Duck.ai returned no response body",
        type: "upstream_error",
      }),
    };
  }

  const reader = chatResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      const finalChunks = extractDuckAiSseChunks(buffer, true).chunks;
      for (const rawChunk of finalChunks) {
        const event = createDuckAiStreamEvent(rawChunk);
        if (!event) continue;

        if (event.kind === "error") {
          await reader.cancel().catch(() => {});
          return classifyDuckAiStreamError(event);
        }

        // Got content — build the streaming response from here
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();

        void pumpDuckAiStreamToWriter(
          writer, encoder, cid, created, model, signal,
          event.content, finalChunks.slice(finalChunks.indexOf(rawChunk) + 1)
        );

        return {
          response: new Response(readable, {
            status: 200,
            headers: { ...SSE_HEADERS_NO_BUFFER },
          }),
        };
      }

      // Stream ended with no content and no error
      await reader.cancel().catch(() => {});
      return {
        retryableError: new DuckAiRetryableError(
          "Duck.ai stream ended before producing output.",
          {
            phase: "chat_stream_prelude",
            retryClass: "empty_stream",
          }
        ),
      };
    }

    buffer += decoder.decode(value, { stream: true });
    const extracted = extractDuckAiSseChunks(buffer);
    buffer = extracted.rest;

    for (let index = 0; index < extracted.chunks.length; index++) {
      const rawChunk = extracted.chunks[index];
      const event = createDuckAiStreamEvent(rawChunk);
      if (!event) continue;

      if (event.kind === "error") {
        await reader.cancel().catch(() => {});
        return classifyDuckAiStreamError(event);
      }

      // Got content — build streaming response from remaining chunks
      const encoder = new TextEncoder();
      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();

      void pumpDuckAiStreamToWriter(
        writer, encoder, cid, created, model, signal,
        event.content, extracted.chunks.slice(index + 1), reader, buffer
      );

      return {
        response: new Response(readable, {
          status: 200,
          headers: { ...SSE_HEADERS_NO_BUFFER },
        }),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Attempt-level helper (extracted from execute retry loop)
// ---------------------------------------------------------------------------


