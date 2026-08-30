import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const GEMINI_API = PROVIDERS["gemini-web"].baseUrl as string;
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
  // Gemini returns a JSON array: [[null, "response_text", null, ...]]
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

        // Simulate streaming by chunking the response
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

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", PROVIDERS["gemini-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const prompt = parseOpenAIMessages(messages);
    if (!prompt.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_API, headers: {} as Record<string, string>, transformedBody: body };
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

    if (credentials.apiKey) {
      headers["Cookie"] = `__Secure-1PSID=${credentials.apiKey}`;
    }

    // Gemini uses form-encoded body with specific structure
    const inner = JSON.stringify([null, JSON.stringify([[prompt, 0, null, null, null, null, 0]])]);
    const formBody = `f.req=${encodeURIComponent(inner)}&at=${encodeURIComponent(crypto.randomUUID())}`;

    log?.info?.("GEMINI-WEB", `Query to ${model}, len=${prompt.length}`);

    let response: Response;
    try {
      response = await fetch(GEMINI_API, {
        method: "POST", headers, body: formBody, signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("GEMINI-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Gemini connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_API, headers, transformedBody: { prompt } };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Gemini returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Gemini auth failed — __Secure-1PSID cookie may be expired. Re-paste your cookie from gemini.google.com.";
      else if (status === 429) errMsg = "Gemini rate limited. Wait a moment and retry.";
      log?.warn?.("GEMINI-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_API, headers, transformedBody: { prompt } };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Gemini returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_API, headers, transformedBody: { prompt } };
    }

    // Read full response body (Gemini returns complete response, not SSE)
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
        error: { message: "Failed to parse Gemini response", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GEMINI_API, headers, transformedBody: { prompt } };
    }

    const cid = `chatcmpl-gmw-${crypto.randomUUID().slice(0, 12)}`;
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
    return { response: finalResponse, url: GEMINI_API, headers, transformedBody: { prompt } };
  }
}

export default GeminiWebExecutor;
