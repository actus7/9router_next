import { BaseExecutor } from "./base";
import type { ExecuteArgs } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { dbg } from "../utils/debugLog";
import type { Logger } from "../services/types";

const QUILLBOT_BASE = "https://quillbot.com/api/ai-chat/chat/conversation";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const WEBAPP_VERSION = process.env.QUILLBOT_WEBAPP_VERSION?.trim() || "40.148.5";
const CONNECT_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b: number) => b.toString(16).padStart(2, "0")).join("");
}

function extractCookies(headers: Headers): string {
  const setCookies = headers.getSetCookie?.() ?? [];
  return setCookies
    .map((c: string) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function mergeCookies(...parts: Array<string | undefined>): string {
  const map = new Map<string, string>();
  for (const part of parts) {
    if (!part) continue;
    for (const pair of part.split(";")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      map.set(trimmed.slice(0, eqIdx), trimmed);
    }
  }
  return Array.from(map.values()).join("; ");
}

const WARM_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Ch-Ua": '"Chromium";v="146", "Google Chrome";v="146", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

async function getQuillbotCookies(proxyOptions: unknown, log?: Logger): Promise<string> {
  let mergedCookies = "";

  // Warm-up: fetch the AI chat page with full browser headers to collect cookies
  const resp = await proxyAwareFetch("https://quillbot.com/ai-chat", {
    headers: WARM_HEADERS,
  }, proxyOptions as null);

  const warmCookies = extractCookies(resp.headers);
  mergedCookies = mergeCookies(mergedCookies, warmCookies);

  // Check for Cloudflare challenge (403 with HTML body)
  if (resp.status === 403) {
    const body = await resp.text().catch(() => "");
    if (body.includes("challenge") || body.includes("cf-") || body.includes("turnstile")) {
      log?.warn?.("QUILLBOT", "Cloudflare challenge detected on warm-up — cookies may be insufficient");
    }
  }

  // Fetch the main page to collect additional cookies
  const mainResp = await proxyAwareFetch("https://quillbot.com", {
    headers: { ...WARM_HEADERS, Referer: "https://quillbot.com/" },
  }, proxyOptions as null);
  mergedCookies = mergeCookies(mergedCookies, extractCookies(mainResp.headers));

  // Generate anonymous identity cookies
  const anonId = randomHex(8);
  const deviceId = crypto.randomUUID();
  const qbAnonId = `${randomHex(32)}.${randomHex(32)}`;

  return mergeCookies(
    mergedCookies,
    `anonID=${anonId}`,
    `qbDeviceId=${deviceId}`,
    `qb_anon_id=${qbAnonId}`,
    "authenticated=false",
    "premium=false",
  );
}

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
        // Initial role chunk
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        let sawCompleted = false;
        for (const chunk of parseQuillbotStream(rawText)) {
          if (chunk.type === "content" && chunk.content) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: chunk.content }, finish_reason: null, logprobs: null }],
            })));
          } else if (chunk.type === "status" && chunk.status === "completed") {
            sawCompleted = true;
          }
        }

        // Always emit stop
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${msg}]` }, finish_reason: "stop", logprobs: null }],
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

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: ExecuteArgs) {
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

    // 1. Obtain cookies
    let cookies: string;
    try {
      cookies = await getQuillbotCookies(proxyOptions, log);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("QUILLBOT", `Cookie fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Quillbot cookie fetch failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: QUILLBOT_BASE, headers: {} as Record<string, string>, transformedBody: body };
    }

    // 2. Build request
    const payload = {
      message: { content: userText, files: [] },
      context: {},
      origin: { name: "ai-chat.chat", url: "https://quillbot.com" },
    };

    // 3. Fetch upstream with retry on 403
    let response: Response;
    let lastChatUrl = QUILLBOT_BASE;
    let lastHeaders: Record<string, string> = {};

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const conversationId = crypto.randomUUID();
      const chatUrl = `${QUILLBOT_BASE}/${conversationId}`;
      lastChatUrl = chatUrl;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": UA,
        Origin: "https://quillbot.com",
        Referer: `https://quillbot.com/ai-chat/c/${conversationId}`,
        "Sec-Ch-Ua": '"Chromium";v="146", "Google Chrome";v="146", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "platform-type": "webapp",
        "qb-product": "AI-CHAT",
        useridtoken: "empty-token",
        "webapp-version": WEBAPP_VERSION,
        Cookie: cookies,
      };
      lastHeaders = headers;

      log?.info?.("QUILLBOT", `Chat to ${chatUrl}, len=${userText.length}${attempt > 0 ? ` (retry ${attempt})` : ""}`);

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

      // Success or non-retryable error
      if (response.ok) break;

      const status = response.status;

      // Retry on 403 with fresh cookies
      if (status === 403 && attempt < MAX_RETRIES) {
        log?.warn?.("QUILLBOT", `HTTP 403 on attempt ${attempt + 1}, refreshing cookies and retrying...`);
        try {
          cookies = await getQuillbotCookies(proxyOptions, log);
        } catch { /* keep existing cookies */ }
        await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * (attempt + 1)));
        continue;
      }

      // Non-retryable error
      let errMsg = `Quillbot returned HTTP ${status}`;
      if (status === 429) errMsg = "Quillbot rate limited. Wait a moment and retry.";
      log?.warn?.("QUILLBOT", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: chatUrl, headers, transformedBody: payload };
    }

    // 4. Handle non-OK (shouldn't reach here, but safety)
    if (!response!.ok) {
      const status = response!.status;
      let errMsg = `Quillbot returned HTTP ${status}`;
      if (status === 429) errMsg = "Quillbot rate limited. Wait a moment and retry.";
      log?.warn?.("QUILLBOT", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: lastChatUrl, headers: lastHeaders, transformedBody: payload };
    }

    if (!response!.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Quillbot returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: lastChatUrl, headers: lastHeaders, transformedBody: payload };
    }

    // 5. Read full body (Quillbot streams the whole thing, then we parse)
    const rawText = await response!.text();

    // HTML check → block/rate-limit
    const head = rawText.trimStart().toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html")) {
      log?.warn?.("QUILLBOT", "Received HTML instead of stream — possible block or rate limit");
      const errResp = new Response(JSON.stringify({
        error: { message: "Quillbot returned HTML instead of expected stream (block, rate limit or API change).", type: "upstream_error", code: "HTTP_502" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: lastChatUrl, headers: lastHeaders, transformedBody: payload };
    }

    dbg("QUILLBOT", `Upstream body ${rawText.length}B`);

    // 6. Build final response
    const cid = `chatcmpl-qb-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(rawText, model, cid, created);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      finalResponse = buildNonStreamingResponse(rawText, model, cid, created);
    }

    return { response: finalResponse, url: lastChatUrl, headers: lastHeaders, transformedBody: payload };
  }
}

export default QuillbotExecutor;
