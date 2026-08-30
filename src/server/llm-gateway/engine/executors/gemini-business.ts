import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const GEMINI_BUSINESS_API = PROVIDERS["gemini-business"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function parseOpenAIMessages(messages: Record<string, unknown>[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => String(c.text || "")).join(" ");
    }
    if (!content.trim()) continue;
    parts.push(`${role}: ${content}`);
  }
  return parts.join("\n\n");
}

function parseGeminiResponse(raw: string): string {
  try {
    const outer = JSON.parse(raw);
    const inner = outer?.[0];
    if (Array.isArray(inner)) {
      for (const item of inner) {
        if (Array.isArray(item) && typeof item[0] === "string") return item[0];
        if (typeof item === "string") return item;
      }
    }
  } catch { /* fall through */ }
  return "";
}

function buildStreamingResponse(content: string, model: string, cid: string, created: number) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        const chunkSize = 20;
        for (let i = 0; i < content.length; i += chunkSize) {
          const slice = content.slice(i, i + chunkSize);
          controller.enqueue(encoder.encode(sseChunk({
            id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
            choices: [{ index: 0, delta: { content: slice }, finish_reason: null, logprobs: null }],
          })));
        }

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${errorMsg}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        controller.close();
      }
    },
  });
}

export class GeminiBusinessExecutor extends BaseExecutor {
  constructor() {
    super("gemini-business", PROVIDERS["gemini-business"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_BUSINESS_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const prompt = parseOpenAIMessages(messages);
    if (!prompt.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_BUSINESS_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
    };

    // Parse cookies: expect "__Secure-1PSID=xxx; __Secure-1PSIDTS=yyy" or just the PSID value
    if (credentials.apiKey) {
      let cookie = credentials.apiKey;
      if (!cookie.includes("=")) {
        cookie = `__Secure-1PSID=${cookie}`;
      }
      headers["Cookie"] = cookie;
    }

    const inner = JSON.stringify([null, JSON.stringify([[prompt, 0, null, null, null, null, 0]])]);
    const formBody = `f.req=${encodeURIComponent(inner)}&at=${encodeURIComponent(crypto.randomUUID())}`;

    log?.info?.("GEMINI-BUSINESS", `Query to ${model}, len=${prompt.length}`);

    let response: Response;
    try {
      response = await fetch(GEMINI_BUSINESS_API, {
        method: "POST", headers, body: formBody, signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("GEMINI-BUSINESS", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Gemini Business connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_BUSINESS_API, headers, transformedBody: { prompt } };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Gemini Business returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Gemini Business auth failed — cookies may be expired. Re-paste your __Secure-1PSID and __Secure-1PSIDTS cookies from business.gemini.google.com.";
      else if (status === 429) errMsg = "Gemini Business rate limited. Wait a moment and retry.";
      log?.warn?.("GEMINI-BUSINESS", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_BUSINESS_API, headers, transformedBody: { prompt } };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Gemini Business returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_BUSINESS_API, headers, transformedBody: { prompt } };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rawText = "";
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      rawText += decoder.decode(value, { stream: true });
    }
    rawText += decoder.decode();
    reader.releaseLock();

    const content = parseGeminiResponse(rawText);
    if (!content) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Failed to parse Gemini Business response", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_BUSINESS_API, headers, transformedBody: { prompt } };
    }

    const cid = `chatcmpl-gmb-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(content, model, cid, created);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      const promptTokens = Math.ceil(content.length / 4);
      const completionTokens = Math.ceil(content.length / 4);
      finalResponse = new Response(JSON.stringify({
        id: cid, object: "chat.completion", created, model, system_fingerprint: null,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return { response: finalResponse, url: GEMINI_BUSINESS_API, headers, transformedBody: { prompt } };
  }
}

export default GeminiBusinessExecutor;
