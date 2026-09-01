import { BaseExecutor } from "./base";
import type { Logger } from "../services/types";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers";
import { HTTP_STATUS } from "../config/runtimeConfig";
import {
  generateCursorBody,
  decodeMessage
} from "../utils/cursorProtobuf";
import { buildCursorHeaders } from "../utils/cursorChecksum";
import { estimateUsage } from "../utils/usageTracking";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants";
import { chatChunkSse, sseChunk } from "../utils/sse";
import { FORMATS } from "../translator/formats";
import { proxyAwareFetch } from "../utils/proxyFetch";
import {
  AGENT_RUN_PATH,
  buildAgentRunFrame,
  createRequestContextResponse,
  decodeAgentFrames,
  extractAgentString,
  isAgentTextRequest,
} from "./cursorAgentProtocol";
import { debugLog, setupHttp2Request } from "./cursorSseProtocol";
import {
  transformCursorProtobufToJSON,
  transformCursorProtobufToSSE,
} from "./cursorResponseTransforms";

interface CursorResponse {
  status: number;
  headers: Record<string, unknown>;
  body: Buffer;
}

// Detect cloud environment
const isCloudEnv = () => {
  if (typeof caches !== "undefined" && typeof caches === "object") return true;
  if (typeof (globalThis as Record<string, unknown>).EdgeRuntime !== "undefined") return true;
  return false;
};

// Lazy import http2 (only in Node.js environment)
let http2: typeof import("http2") | null = null;
if (!isCloudEnv()) {
  try {
    http2 = await import("http2");
  } catch {
    // http2 not available
  }
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  buildHeaders(credentials: Record<string, unknown>, _stream = true, ..._extraArgs: unknown[]) {
    const accessToken = (credentials as Record<string, unknown>).accessToken as string;
    const providerData = (credentials as Record<string, unknown>).providerSpecificData as Record<string, unknown> | undefined;
    const machineId = providerData?.machineId as string | undefined;
    const ghostMode = providerData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode);
  }

  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown>): Record<string, unknown> {
    // Messages are already translated by chatCore (claude→openai→cursor)
    // Do NOT call openaiToCursorRequest again — double-translation drops tool_results
    const messages = (body.messages || []) as Record<string, unknown>[];
    const tools = (body.tools || []) as Record<string, unknown>[];
    const reasoningEffort = (body.reasoning_effort || null) as string | null;
    // Detect Claude Code UA to force Agent mode (issue #643)
    const ua = ((credentials as Record<string, unknown>).rawHeaders as Record<string, string> | undefined)?.["user-agent"] || "";
    const forceAgentMode = ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code");
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode) as unknown as Record<string, unknown>;
  }

  async makeFetchRequest(url: string, headers: Record<string, string>, body: Buffer, signal?: AbortSignal, proxyOptions: Record<string, unknown> | null = null): Promise<CursorResponse> {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: body as unknown as BodyInit,
      signal
    }, proxyOptions);

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer())
    };
  }

  makeHttp2Request(url: string, headers: Record<string, string>, body: Buffer, signal?: AbortSignal): Promise<CursorResponse> {
    if (!http2) {
      throw new Error("http2 module not available");
    }

    const HTTP2_TIMEOUT_MS = 60000; // 60s max — prevent hung sessions

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`);
      const chunks: Buffer[] = [];
      let responseHeaders: Record<string, unknown> = {};
      let settled = false;

      // Ensure client is always closed on settle
      const finish = (fn: (...a: unknown[]) => void) => (...args: unknown[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(hangTimeout);
        client.close();
        fn(...args);
      };

      // Hard timeout: close session if server never responds
      const hangTimeout = setTimeout(finish(() => {
        reject(new Error("HTTP/2 request timed out"));
      }), HTTP2_TIMEOUT_MS);

      client.on("error", finish(reject));

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      });

      req.on("response", (hdrs: Record<string, unknown>) => { responseHeaders = hdrs; });
      req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      req.on("end", finish(() => {
        resolve({
          status: (responseHeaders as Record<string, unknown>) [":status"] as number,
          headers: responseHeaders,
          body: Buffer.concat(chunks)
        });
      }));
      req.on("error", finish(reject));

      if (signal) {
        const onAbort = finish(() => reject(new Error("Request aborted")));
        signal.addEventListener("abort", onAbort, { once: true });
      }

      req.write(body);
      req.end();
    });
  }

  /**
   * AgentService (agent.api5.cursor.sh) is HTTP/2-only. Node's fetch/undici speaks
   * HTTP/1.1 and fails with HTTPParserError on the h2 preface — use http2 duplex.
   */
  openAgentHttp2Stream(url: string, headers: Record<string, string>, signal: AbortSignal | null) {
    if (!http2) {
      throw new Error("HTTP/2 is required for Cursor AgentService (endpoint is h2-only)");
    }

    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`);
    const chunkQueue: Buffer[] = [];
    let waiting: ((value: { value: Buffer | undefined; done: boolean } | null) => void) | null = null;
    const state = { ended: false, streamError: null as Error | null };

    const wake = (result: { value: Buffer | undefined; done: boolean } | null) => {
      if (!waiting) return;
      const resolve = waiting;
      waiting = null;
      resolve(result);
    };

    const fail = (error: Error) => {
      if (state.streamError) return;
      state.streamError = error;
      state.ended = true;
      wake(null);
    };

    const close = () => {
      try { req?.destroy(); } catch {}
      try { client.close(); } catch {}
    };

    client.on("error", fail);
    const req = setupHttp2Request(client, urlObj, headers, state, wake, chunkQueue);

    if (signal) {
      const onAbort = () => {
        fail(new Error("Request aborted"));
        close();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const responseHeaders = new Promise<Record<string, unknown>>((resolve, reject) => {
      const onEarlyError = (error: Error) => reject(error);
      client.once("error", onEarlyError);
      req!.once("error", onEarlyError);
      req!.once("response", (hdrs: Record<string, unknown>) => {
        client.off("error", onEarlyError);
        req!.off("error", onEarlyError);
        resolve(hdrs);
      });
    });

    return {
      responseHeaders,
      write(frame: Uint8Array) {
        if (req && !req.destroyed) req.write(Buffer.from(frame));
      },
      end() {
        try { if (req && !req.destroyed) req.end(); } catch {}
      },
      close,
      async read() {
        if (chunkQueue.length) return { value: chunkQueue.shift(), done: false };
        if (state.ended) {
          if (state.streamError) throw state.streamError;
          return { value: undefined, done: true };
        }
        const result = await new Promise((resolve) => { waiting = resolve; });
        if (state.streamError) throw state.streamError;
        return result || { value: undefined, done: true };
      },
    };
  }

  async executeAgent({ model, body, stream, credentials, signal }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Record<string, unknown>; signal?: AbortSignal }) {
    const agentEndpoint = PROVIDER_OAUTH.cursor?.agentEndpoint;
    if (!agentEndpoint) throw new Error("Cursor AgentService endpoint is not configured");

    const url = `${agentEndpoint}${AGENT_RUN_PATH}`;
    const headers = this.buildHeaders(credentials);
    const requestController = new AbortController();
    if (signal?.addEventListener) {
      signal.addEventListener("abort", () => requestController.abort(signal.reason), { once: true });
    }

    let session;
    try {
      session = this.openAgentHttp2Stream(url, headers, requestController.signal);
      session.write(buildAgentRunFrame(((body.messages || []) as Record<string, unknown>[]), model));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Cursor AgentService request failed: ${msg}`);
    }

    let responseHeaders: Record<string, unknown>;
    try {
      responseHeaders = await session.responseHeaders;
    } catch (error: unknown) {
      session.close();
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Cursor AgentService request failed: ${msg}`);
    }

    const status = Number((responseHeaders as Record<string, unknown>) [":status"] || 0);
    if (status !== 200) {
      let errorText = "";
      try {
        while (true) {
          const readResult = await session.read() as { done: boolean; value: Buffer | undefined } | null;
          if (!readResult || readResult.done) break;
          errorText += Buffer.from(readResult.value!).toString("utf8");
        }
      } catch {}
      session.close();
      return {
        response: new Response(JSON.stringify({
          error: { message: `Cursor AgentService ${status}: ${errorText || "request failed"}`, type: "api_error" },
        }), { status: status || HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    // The Claude SSE translator derives Anthropic's message ID by stripping
    // `chatcmpl-`. Keep the remaining ID in Anthropic's required `msg_` form
    // so strict clients such as Claude Code accept the completed stream.
    const responseId = `chatcmpl-msg_${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let pending = Buffer.alloc(0);
    let finished = false;

    const consume = async (onEvent: (event: { type: string; value?: string }) => void) => {
      try {
        while (!finished) {
          const readResult = await session.read() as { done: boolean; value: Buffer | undefined } | null;
          if (!readResult || readResult.done) break;
          pending = Buffer.concat([pending, Buffer.from(readResult.value!)]);
          pending = decodeAgentFrames(pending, (payload) => {
            // A single read can carry several frames; once the turn is over the
            // rest of the batch must not reach the already-closed controller.
            if (finished) return;
            const serverMessage = decodeMessage(payload);

            // agent.v1.AgentServerMessage.interaction_update
            if (serverMessage.has(1)) {
              const update = decodeMessage(serverMessage.get(1)![0].value as Uint8Array);
              if (update.has(1)) {
                const textDelta = extractAgentString(decodeMessage(update.get(1)![0].value as Uint8Array), 1);
                if (textDelta) onEvent({ type: "text", value: textDelta });
              }
              // Cursor's AgentService emits internal reasoning without the
              // cryptographic signature required by Anthropic thinking blocks.
              // Forwarding it makes strict Anthropic clients (Claude Code)
              // discard or wait on an otherwise complete response. Keep the
              // reasoning upstream-only and emit the normal answer text.
              if (update.has(14)) {
                finished = true;
                onEvent({ type: "done" });
              }
            }

            // AgentService requests IDE context before producing a response.
            // Return an empty context; modelhub is not coupled to an editor.
            if (serverMessage.has(2)) {
              const execRequest = decodeMessage(serverMessage.get(2)![0].value as Uint8Array);
              if (execRequest.has(10)) {
                session.write(createRequestContextResponse());
              } else {
                // Every other ExecServerMessage variant is an editor-backed tool
                // (shell, read, write, …) that modelhub cannot service. Fail the
                // turn rather than narrating protocol state as assistant text.
                debugLog(`[CURSOR AGENT] Unsupported exec request fields: ${[...execRequest.keys()].join(",")}`);
                finished = true;
                onEvent({ type: "error", value: "Cursor AgentService requested an unsupported IDE tool" });
              }
            }
          });
        }
      } finally {
        try { session.end(); } catch {}
        try { session.close(); } catch {}
        if (!finished) onEvent({ type: "done" });
      }
    };

    if (stream === false) {
      let content = "";
      let reasoning = "";
      let agentError = null;
      await consume((event) => {
        if (event.type === "text") content += event.value;
        else if (event.type === "thinking") reasoning += event.value;
        else if (event.type === "error") agentError = event.value;
      });
      if (agentError) {
        return {
          response: new Response(JSON.stringify({ error: { message: agentError, type: "api_error" } }), {
            status: HTTP_STATUS.BAD_REQUEST,
            headers: { "Content-Type": "application/json" },
          }),
          url,
          headers,
          transformedBody: body,
          responseFormat: FORMATS.OPENAI,
        };
      }
      return {
        response: new Response(JSON.stringify({
          id: responseId,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: content || null, ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: "stop" }],
          usage: estimateUsage(body, content.length, FORMATS.OPENAI),
        }), { headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      start(controller) {
        consume((event) => {
          if (event.type === "text") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { content: event.value } })));
          } else if (event.type === "thinking") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: { reasoning_content: event.value } })));
          } else if (event.type === "error") {
            // An SSE error frame, not a content delta: a protocol failure must not
            // be rendered to the user as the assistant's reply, and downstream
            // usage tracking must not record the turn as a success.
            controller.enqueue(encoder.encode(sseChunk({ error: { message: event.value, type: "api_error" } })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          } else if (event.type === "done") {
            controller.enqueue(encoder.encode(chatChunkSse({ id: responseId, created, model, delta: {}, finishReason: "stop" })));
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
          }
        }).catch((error) => controller.error(error));
      },
      cancel() {
        requestController.abort();
      },
    });

    return {
      response: new Response(responseStream, { headers: SSE_HEADERS }),
      url,
      headers,
      transformedBody: body,
      responseFormat: FORMATS.OPENAI,
    };
  }

  async execute({ model, body, stream, credentials, signal, log: _log, proxyOptions = null }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Record<string, unknown>; signal?: AbortSignal; log: Logger; proxyOptions?: Record<string, unknown> | null }) {
    if (isAgentTextRequest(body)) {
      try {
        return await this.executeAgent({ model, body, stream, credentials, signal });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          response: new Response(JSON.stringify({
            error: { message: msg, type: "connection_error", code: "" },
          }), { status: HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
          url: `${PROVIDER_OAUTH.cursor?.agentEndpoint || ""}${AGENT_RUN_PATH}`,
          headers: {},
          transformedBody: body,
        };
      }
    }

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    try {
      const proxyOpts = proxyOptions as Record<string, unknown> | null | undefined;
      const shouldForceFetch = proxyOpts?.enabled === true || proxyOpts?.connectionProxyEnabled === true || !!proxyOpts?.vercelRelayUrl;
      const response = (http2 && !shouldForceFetch)
        ? await this.makeHttp2Request(url, headers, transformedBody as unknown as Buffer, signal)
        : await this.makeFetchRequest(url, headers, transformedBody as unknown as Buffer, signal, proxyOptions);

      if (response.status !== 200) {
        const errorText = response.body?.toString() || "Unknown error";
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `[${response.status}]: ${errorText}`,
            type: "invalid_request_error",
            code: ""
          }
        }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
        return { response: errorResponse, url, headers, transformedBody: body };
      }

      const transformedResponse = stream !== false
        ? this.transformProtobufToSSE(response.body, model, body)
        : this.transformProtobufToJSON(response.body, model, body);

      return { response: transformedResponse, url, headers, transformedBody: body };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: msg,
          type: "connection_error",
          code: ""
        }
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { "Content-Type": "application/json" }
      });
      return { response: errorResponse, url, headers, transformedBody: body };
    }
  }

  transformProtobufToJSON(buffer: Buffer<ArrayBufferLike>, model: string, body: Record<string, unknown>) {
    return transformCursorProtobufToJSON(buffer, model, body);
  }

  transformProtobufToSSE(buffer: Buffer<ArrayBufferLike>, model: string, body: Record<string, unknown>) {
    return transformCursorProtobufToSSE(buffer, model, body);
  }

  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;
