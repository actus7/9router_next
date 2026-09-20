import { BaseExecutor } from "./base";
import type { ExecuteArgs } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { dbg } from "../utils/debugLog";

const QUILLBOT_BASE = "https://api.quillbot.com/api/ai-chat/chat/conversation";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const WEBAPP_VERSION = process.env.QUILLBOT_WEBAPP_VERSION?.trim() || "40.148.5";
const CONNECT_TIMEOUT_MS = 25_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLastUserMessage(messages: Record<string, unknown>[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c: Record<string, unknown>) => c.type === "text")
        .map((c: Record<string, unknown>) => String(c.text || ""))
        .join(" ");
    }
  }
  return "";
}

// ── Stream parsing (hybrid NDJSON / SSE) ─────────────────────────────────────

interface QuillbotChunk {
  type?: string;
  content?: string;
  status?: string;
}

function* parseQuillbotStream(rawText: string): Generator<QuillbotChunk> {
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let jsonLine = trimmed;
    if (trimmed.startsWith("data:")) {
      jsonLine = trimmed.slice(5).trim();
      if (jsonLine === "[DONE]") {
        yield { type: "status", status: "completed" };
        continue;
      }
    }

    try {
      yield JSON.parse(jsonLine) as QuillbotChunk;
    } catch {
      // malformed → skip
    }
  }
}

// ── SSE stream builder ───────────────────────────────────────────────────────


function buildStreamingResponse(rawText: string, model: string, cid: string, created: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));
        for (const chunk of parseQuillbotStream(rawText)) {
          if (chunk.type === "content" && chunk.content) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: null, logprobs: null }],
            })));
          }
        }
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${message}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        controller.close();
      }
    },
  });
}

function buildNonStreamingResponse(rawText: string, model: string, cid: string, created: number): Response {
  let fullContent = "";
  for (const chunk of parseQuillbotStream(rawText)) {
    if (chunk.type === "content" && chunk.content) {
      fullContent += chunk.content;
    }
  }

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ── Executor ─────────────────────────────────────────────────────────────────

export class QuillbotExecutor extends BaseExecutor {
  constructor() {
    super("quillbot", { ...PROVIDERS["quillbot"], noAuth: true });
  }

  async execute({ model, body, stream, credentials: _credentials, signal, log, proxyOptions = null }: ExecuteArgs) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: QUILLBOT_BASE, headers: {} as Record<string, string>, transformedBody: body };
    }

    const userText = getLastUserMessage(messages);
    if (!userText.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "No user message found", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: QUILLBOT_BASE, headers: {} as Record<string, string>, transformedBody: body };
    }

    // 1. Build request. api.quillbot.com serves the AI-chat API without any
    // cookie, token or browser header — the www host is behind a Cloudflare
    // managed challenge that no non-browser client can pass.
    const payload = {
      message: { content: userText, files: [] },
      context: {},
      origin: { name: "ai-chat.chat", url: "https://quillbot.com" },
    };

    const conversationId = crypto.randomUUID();
    const chatUrl = `${QUILLBOT_BASE}/${conversationId}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": UA,
      Origin: "https://quillbot.com",
      Referer: `https://quillbot.com/ai-chat/c/${conversationId}`,
      "platform-type": "webapp",
      "qb-product": "AI-CHAT",
      useridtoken: "empty-token",
      "webapp-version": WEBAPP_VERSION,
    };

    log?.info?.("QUILLBOT", `Chat to ${chatUrl}, len=${userText.length}`);

    // 2. Fetch upstream
    let response: Response;
    try {
      const connectCtrl = new AbortController();
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), CONNECT_TIMEOUT_MS);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        response = await proxyAwareFetch(chatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: mergedSignal,
        }, proxyOptions as null);
      } finally {
        clearTimeout(connectTimer);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("QUILLBOT", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Quillbot connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: chatUrl, headers, transformedBody: payload };
    }

    // 3. Surface upstream failures as-is; the gateway marks per-model availability.
    if (!response.ok) {
      const status = response.status;
      let errMsg = `Quillbot returned HTTP ${status}`;
      if (status === 429) errMsg = "Quillbot rate limited. Wait a moment and retry.";
      else if (status === 403) errMsg = "Quillbot blocked the request (Cloudflare challenge).";
      log?.warn?.("QUILLBOT", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: chatUrl, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Quillbot returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: chatUrl, headers, transformedBody: payload };
    }

    // 4. Read full body (Quillbot streams the whole thing, then we parse)
    const rawText = await response.text();

    // HTML check → block/rate-limit
    const head = rawText.trimStart().toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html")) {
      log?.warn?.("QUILLBOT", "Received HTML instead of stream — possible block or rate limit");
      const errResp = new Response(JSON.stringify({
        error: { message: "Quillbot returned HTML instead of expected stream (block, rate limit or API change).", type: "upstream_error", code: "HTTP_502" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: chatUrl, headers, transformedBody: payload };
    }

    dbg("QUILLBOT", `Upstream body ${rawText.length}B`);

    // 5. Build final response
    const cid = `chatcmpl-qb-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(rawText, model, cid, created);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      finalResponse = buildNonStreamingResponse(rawText, model, cid, created);
    }

    return { response: finalResponse, url: chatUrl, headers, transformedBody: payload };
  }
}
