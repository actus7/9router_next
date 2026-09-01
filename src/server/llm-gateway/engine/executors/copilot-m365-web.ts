import WebSocket from "ws";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";
import { buildPrompt, buildWsUrl, redactWsUrl, resolveConnectionParams } from "./copilot-m365-web/connection";
import {
  accumulateBotContent,
  buildChatInvocation,
  encodeFrame,
  extractCompletionError,
  extractFinalResultMessage,
  handshakeError,
  handshakeFrame,
  isCompletionFrame,
  keepaliveFrame,
  metricsFrame,
  parseFrame,
  resolveChatInvocationOverrides,
  resolveToneForModel,
  splitFrames,
} from "./copilot-m365-web/frames";

const M365_WS_TIMEOUT_MS = 90_000;
const M365_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function sseChunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: `chatcmpl-copilot-m365-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function errorResponse(message: string, status = 502): Response {
  return new Response(JSON.stringify({ error: { message } }), { status, headers: { "Content-Type": "application/json" } });
}

function handleM365Frame(
  rawFrame: string,
  ctx: {
    handshakeComplete: boolean;
    previousText: string;
    finalResultMessage: string;
    settled: boolean;
  },
  opts: { model: string; tier?: string },
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  timeout: ReturnType<typeof setTimeout>,
  ws: WebSocket | null,
  cleanup: () => void,
  finish: () => void,
  abort: (reason: string) => void
) {
  const frame = parseFrame(rawFrame);

  if (!ctx.handshakeComplete) {
    const err = handshakeError(frame);
    if (err) {
      clearTimeout(timeout);
      abort(`Microsoft 365 Copilot handshake failed: ${err}`);
      return;
    }
    ctx.handshakeComplete = true;
    const overrides = resolveChatInvocationOverrides(opts.tier);
    const tone = resolveToneForModel(opts.model) ?? overrides.tone;
    const invocationFrame = encodeFrame(buildChatInvocation({
      text: "", traceId: "", sessionId: "", requestId: "", conversationId: "",
      isStartOfSession: true, ...overrides, tone,
    }));
    ws?.send(invocationFrame + metricsFrame());
    return;
  }

  if (frame?.type === 6) {
    try { ws?.send(keepaliveFrame()); } catch { /* socket already closing */ }
    return;
  }

  const { delta, next } = accumulateBotContent(ctx.previousText, frame);
  ctx.previousText = next;
  if (delta) controller.enqueue(encoder.encode(sseChunk(opts.model, { content: delta })));

  const finalMsg = extractFinalResultMessage(frame);
  if (finalMsg) ctx.finalResultMessage = finalMsg;

  const completionError = extractCompletionError(frame);
  if (completionError) {
    clearTimeout(timeout);
    abort(`Microsoft 365 Copilot invocation failed: ${completionError}`);
    return;
  }

  if (isCompletionFrame(frame)) {
    clearTimeout(timeout);
    finish();
  }
}

/** Opens the BizChat SignalR WebSocket, runs the handshake + chat invocation,
 * and streams the accumulated answer back as OpenAI SSE chunks. */
function wsChat(opts: { wsUrl: string; prompt: string; model: string; tier?: string; signal?: AbortSignal; log?: Logger }): ReadableStream<Uint8Array> {
  const log = opts.log;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let ws: WebSocket | null = null;
      const settled = false;
      const ctx = { handshakeComplete: false, previousText: "", finalResultMessage: "", settled: false };

      const cleanup = () => {
        if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
      };

      const finish = () => {
        if (ctx.settled) return;
        ctx.settled = true;
        cleanup();
        if (!ctx.previousText && ctx.finalResultMessage) ctx.previousText = ctx.finalResultMessage;
        if (!ctx.previousText) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            error: { message: `Microsoft 365 Copilot turn completed with no content in any known frame shape (tier: ${opts.tier || "individual"}).` },
          })}\n\n`));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(sseChunk(opts.model, {}, "stop")));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };

      const abort = (reason: string) => {
        if (ctx.settled) return;
        ctx.settled = true;
        cleanup();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: reason } })}\n\n`));
        controller.close();
      };

      opts.signal?.addEventListener("abort", () => abort("Request aborted"), { once: true });
      const timeout = setTimeout(() => abort("Microsoft 365 Copilot WebSocket timeout"), M365_WS_TIMEOUT_MS);

      try {
        const wsUrlParts = new URL(opts.wsUrl);
        const requestId = wsUrlParts.searchParams.get("chatsessionid") ?? wsUrlParts.searchParams.get("clientrequestid") ?? crypto.randomUUID();
        const sessionId = wsUrlParts.searchParams.get("X-SessionId") ?? crypto.randomUUID();
        const conversationId = wsUrlParts.searchParams.get("ConversationId") ?? crypto.randomUUID();
        const traceId = crypto.randomUUID();

        log?.debug?.("M365_WS", `connecting → ${redactWsUrl(opts.wsUrl)}`);
        ws = new WebSocket(opts.wsUrl, { headers: { Origin: "https://m365.cloud.microsoft", "User-Agent": M365_USER_AGENT } });

        const sendChat = () => {
          const overrides = resolveChatInvocationOverrides(opts.tier);
          const tone = resolveToneForModel(opts.model) ?? overrides.tone;
          const invocationFrame = encodeFrame(buildChatInvocation({
            text: opts.prompt, traceId, sessionId, requestId, conversationId, isStartOfSession: true, ...overrides, tone,
          }));
          ws?.send(invocationFrame + metricsFrame());
        };

        ws.on("open", () => {
          log?.debug?.("M365_WS", "socket open — sending handshake");
          ws?.send(handshakeFrame());
        });

        ws.on("message", (data) => {
          if (ctx.settled) return;
          const buffer = data.toString();
          const split = splitFrames(buffer);
          for (const rawFrame of split.frames) {
            handleM365Frame(rawFrame, ctx, opts, controller, encoder, timeout, ws, cleanup, finish, abort);
            if (ctx.settled) return;
          }
        });

        ws.on("error", (err) => {
          clearTimeout(timeout);
          abort(err instanceof Error ? err.message : "Microsoft 365 Copilot WebSocket error");
        });

        ws.on("close", () => {
          clearTimeout(timeout);
          finish();
        });
      } catch (err) {
        clearTimeout(timeout);
        abort(err instanceof Error ? err.message : "Failed to connect to Microsoft 365 Copilot");
      }
    },
  });
}

async function collectSseText(stream: ReadableStream<Uint8Array>): Promise<{ content: string; error: string | null }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let error: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (parsed.error && typeof parsed.error === "object") {
          error = String((parsed.error as Record<string, unknown>).message || "Microsoft 365 Copilot error");
          continue;
        }
        const choices = parsed.choices as Array<{ delta?: { content?: unknown } }> | undefined;
        const c = choices?.[0]?.delta?.content;
        if (typeof c === "string") content += c;
      } catch { /* skip malformed SSE lines */ }
    }
  }
  return { content, error };
}

export class CopilotM365WebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-m365-web", PROVIDERS["copilot-m365-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse("Missing or empty messages array", 400), url: "wss://substrate.office.com/m365Copilot/Chathub", headers: {} as Record<string, string>, transformedBody: body };
    }

    const prompt = buildPrompt(body).trim();
    if (!prompt) {
      return { response: errorResponse("No user message provided", 400), url: "wss://substrate.office.com/m365Copilot/Chathub", headers: {} as Record<string, string>, transformedBody: body };
    }

    const connectionParams = resolveConnectionParams(credentials);
    if ("error" in connectionParams) {
      return { response: errorResponse(connectionParams.error, 400), url: "wss://substrate.office.com/m365Copilot/Chathub", headers: {} as Record<string, string>, transformedBody: body };
    }

    const wsUrl = buildWsUrl(connectionParams);
    log?.info?.("COPILOT-M365-WEB", `Query to ${model}, tier=${connectionParams.tier || "individual"}`);

    const wsStream = wsChat({ wsUrl, prompt, model, tier: connectionParams.tier, signal, log });

    if (stream) {
      return {
        response: new Response(wsStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: redactWsUrl(wsUrl), headers: {} as Record<string, string>, transformedBody: body,
      };
    }

    const { content, error } = await collectSseText(wsStream);
    if (error) {
      return { response: errorResponse(error), url: redactWsUrl(wsUrl), headers: {} as Record<string, string>, transformedBody: body };
    }
    return {
      response: new Response(JSON.stringify({
        id: `chatcmpl-copilot-m365-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: "assistant", content: content || "(empty response)" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { headers: { "Content-Type": "application/json" } }),
      url: redactWsUrl(wsUrl), headers: {} as Record<string, string>, transformedBody: body,
    };
  }
}

export default CopilotM365WebExecutor;
