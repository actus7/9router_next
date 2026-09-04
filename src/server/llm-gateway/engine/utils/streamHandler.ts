// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig";
import { dbg, isDebugEnabled } from "./debugLog";

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
interface StreamControllerOptions {
  onDisconnect?: (info: { reason: string; duration: number }) => void;
  onError?: (error: unknown) => void;
  log?: { line?: (...args: unknown[]) => void; errorLine?: (...args: unknown[]) => void };
  provider?: string;
  model?: string;
  reqTag?: string;
}

/**
 * What createStreamController hands back. Declared once, here, so the chat
 * pipeline does not have to keep a second copy of it in sync.
 */
export type StreamController = ReturnType<typeof createStreamController>;

export function createStreamController({ onDisconnect, onError, log, provider = "", model = "", reqTag = "" }: StreamControllerOptions = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout: ReturnType<typeof setTimeout> | null = null;

  // Only abnormal terminations are logged; normal completion is covered by "📊 done".
  // isError uses errorLine (always shown, ignores LOG_LEVEL) so failures survive quiet levels.
  const logStream = (symbol: string, status: string, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit) emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);
    else console.log(`[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`);
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      logStream("⚡", `DISCONNECT: ${reason}`);
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally (no line here — "📊 done" is authoritative)
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error: Error & { name?: string }) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("⚡", "ABORTED");
        return;
      }

      logStream("✗", `ERROR: ${error.message}${error.stack ? `\n    ${error.stack}` : ""}`, true);
      onError?.(error);
    },

    abort: () => abortController.abort()
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability.
 *
 * Stall detection lives in pipeWithDisconnect (tied to upstream byte
 * activity), not here — output of the transform stream may be silent
 * for long periods while raw bytes still flow (e.g. Kiro EventStream
 * binary frames buffering, Claude reasoning streams).
 */
function createDisconnectAwareStream(transformStream: TransformStream<Uint8Array, Uint8Array>, streamController: ReturnType<typeof createStreamController>, onAbortTerminal: (() => Uint8Array | null | undefined) | null = null) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  let terminalEmitted = false;

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch { /* best-effort terminal */ }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!streamController.isConnected()) {
        emitTerminal(controller);
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value!);
      } catch (error: unknown) {
        const err = error as Error & { code?: string; cause?: { code?: string } };
        const wasConnected = streamController.isConnected();
        // Controller already closed = downstream ended; not an upstream error, skip noisy log.
        const msg0 = err?.message || "";
        const isControllerClosed = msg0.includes("already closed") || msg0.includes("Invalid state");
        if (!isControllerClosed) streamController.handleError(err);
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});

        // Treat network resets / socket hang up / abort as graceful close
        const msg = err?.message || "";
        const code = err?.code || err?.cause?.code || "";
        const isNetworkClose =
          err.name === "AbortError" ||
          msg.includes("aborted") ||
          msg.includes("socket hang up") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EPIPE") ||
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET";

        // Graceful close on network/abort, or when a structured terminal is available
        // (Responses passthrough prefers response.failed + [DONE] over a raw transport error)
        try {
          if (!wasConnected || isNetworkClose || onAbortTerminal) {
            emitTerminal(controller);
            controller.close();
          } else {
            controller.error(err);
          }
        } catch  { /* already closed or cancelled */ }
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

/**
 * Pipe provider response through transform with disconnect detection.
 *
 * Stall watchdog tracks raw upstream byte activity, not transform output.
 * Reasoning models (Claude thinking via Kiro, etc.) can produce zero SSE
 * output for long stretches while partial EventStream frames keep arriving.
 * Measuring stall on the transform output caused false stalls and the
 * "failed to pipe response" error in Next.
 *
 * Any upstream chunk resets the timer. If no bytes arrive for
 * STREAM_STALL_TIMEOUT_MS, abort the underlying fetch via the controller.
 *
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 */
export function pipeWithDisconnect(providerResponse: Response, transformStream: TransformStream<Uint8Array, Uint8Array>, streamController: ReturnType<typeof createStreamController>, onAbortTerminal: (() => Uint8Array | null | undefined) | null = null, stallTimeoutMs: number = STREAM_STALL_TIMEOUT_MS, firstChunkTimeoutMs: number = stallTimeoutMs) {
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let firstChunkTimer: ReturnType<typeof setTimeout> | null = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  const t0 = Date.now();
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };
  const clearFirstChunk = () => {
    if (firstChunkTimer) { clearTimeout(firstChunkTimer); firstChunkTimer = null; }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      dbg(tag, `STALL TIMEOUT ${stallTimeoutMs}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`);
      streamController.handleError?.(new Error("stream stall timeout"));
      streamController.abort?.();
    }, stallTimeoutMs);
  };
  const armFirstChunk = () => {
    clearFirstChunk();
    firstChunkTimer = setTimeout(() => {
      firstChunkTimer = null;
      if (chunkCount > 0) return;
      dbg(tag, `FIRST CHUNK TIMEOUT ${firstChunkTimeoutMs}ms`);
      streamController.handleError?.(new Error("stream first-chunk timeout"));
      streamController.abort?.();
    }, firstChunkTimeoutMs);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => { dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); clearFirstChunk(); streamController.handleComplete(); },
    handleError: (e: Error) => { dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); clearFirstChunk(); streamController.handleError(e); },
    handleDisconnect: (r: string) => { dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); clearFirstChunk(); streamController.handleDisconnect(r); },
    abort: () => { clearStall(); clearFirstChunk(); streamController.abort(); }
  };

  armFirstChunk();
  dbg(tag, `pipe start | firstChunkTimeout=${firstChunkTimeoutMs}ms | stallTimeout=${stallTimeoutMs}ms`);

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      chunkCount++;
      if (chunkCount === 1) clearFirstChunk();
      const sz = chunk?.byteLength || chunk?.length || 0;
      totalBytes += sz;
      const now = Date.now();
      const gap = now - lastChunkAt;
      lastChunkAt = now;
      if (isDebugEnabled && (chunkCount <= 5 || chunkCount % 20 === 0 || gap > 5000)) {
        dbg(tag, `chunk #${chunkCount} | size=${sz}B | gap=${gap}ms | total=${totalBytes}B`);
      }
      armStall();
      controller.enqueue(chunk);
    },
    flush() { dbg(tag, `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); clearFirstChunk(); }
  });

  const transformedBody = providerResponse.body!
    .pipeThrough(upstreamTap)
    .pipeThrough(transformStream);

  return createDisconnectAwareStream(
    { readable: transformedBody, writable: new WritableStream() } as TransformStream<Uint8Array, Uint8Array>,
    wrappedController as ReturnType<typeof createStreamController>,
    onAbortTerminal
  );
}

