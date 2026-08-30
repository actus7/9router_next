import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const THEOLDLLM_API = PROVIDERS["theoldllm"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// Playwright-based token generator (lazy-loaded)
let playwrightTokenCache: { token: string; fetchedAt: number } | null = null;
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function generateToken(log?: Logger): Promise<string> {
  if (playwrightTokenCache && Date.now() - playwrightTokenCache.fetchedAt < TOKEN_TTL_MS) {
    return playwrightTokenCache.token;
  }

  log?.info?.("THEOLDLLM", "Generating token via Playwright headless browser...");

  let chromium: unknown;
  try {
    // @ts-expect-error — playwright is an optional peer dependency, installed at runtime
    chromium = (await import("playwright")).chromium;
  } catch {
    throw new Error("Playwright is not installed. Run: npm install playwright");
  }

  const browser = await (chromium as { launch: (opts: Record<string, unknown>) => Promise<unknown> }).launch({ headless: true });
  try {
    const page = await (browser as { newPage: () => Promise<Record<string, unknown>> }).newPage();
    await (page as { goto: (url: string) => Promise<void> }).goto("https://theoldllm.com");
    await (page as { waitForTimeout: (ms: number) => Promise<void> }).waitForTimeout(3000);

    // Extract token from page context (localStorage, cookies, or JS variable)
    const token = await (page as { evaluate: (fn: () => string | null) => Promise<string | null> }).evaluate(() => {
      // Try common token storage patterns
      return localStorage.getItem("token")
        || localStorage.getItem("auth_token")
        || localStorage.getItem("access_token")
        || document.cookie.match(/token=([^;]+)/)?.[1]
        || null;
    });

    if (!token) {
      throw new Error("Could not extract token from theoldllm.com — site structure may have changed.");
    }

    playwrightTokenCache = { token, fetchedAt: Date.now() };
    log?.info?.("THEOLDLLM", `Token generated successfully, length=${token.length}`);
    return token;
  } finally {
    await (browser as { close: () => Promise<void> }).close();
  }
}

async function* readSSEEvents(body: ReadableStream, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || !line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try { yield JSON.parse(data) as Record<string, unknown>; } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function buildStreamingResponse(eventStream: ReadableStream, model: string, cid: string, created: number, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        for await (const chunk of readSSEEvents(eventStream, signal)) {
          const choices = chunk.choices as Record<string, unknown>[] | undefined;
          if (choices?.[0]) {
            const delta = choices[0].delta as Record<string, unknown> | undefined;
            if (delta?.content) {
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: delta.content }, finish_reason: null, logprobs: null }],
              })));
            }
          }
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

export class TheOldLLMExecutor extends BaseExecutor {
  constructor() {
    super("theoldllm", PROVIDERS["theoldllm"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: THEOLDLLM_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    // Auto-generate token via Playwright
    let token: string;
    try {
      token = await generateToken(log);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("THEOLDLLM", `Token generation failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `TheOldLLM token generation failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: THEOLDLLM_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://theoldllm.com",
      Referer: "https://theoldllm.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
      Authorization: `Bearer ${token}`,
    };

    const payload = { ...body, model, stream: true };

    log?.info?.("THEOLDLLM", `Query to ${model}, msgs=${messages.length}`);

    let response: Response;
    try {
      response = await fetch(THEOLDLLM_API, {
        method: "POST", headers, body: JSON.stringify(payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("THEOLDLLM", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `TheOldLLM connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: THEOLDLLM_API, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `TheOldLLM returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        errMsg = "TheOldLLM auth failed — auto-generated token may be invalid. Retrying token generation...";
        // Invalidate cache on auth failure
        playwrightTokenCache = null;
      } else if (status === 429) {
        errMsg = "TheOldLLM rate limited. Wait a moment and retry.";
      }
      log?.warn?.("THEOLDLLM", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: THEOLDLLM_API, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "TheOldLLM returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: THEOLDLLM_API, headers, transformedBody: payload };
    }

    const cid = `chatcmpl-toll-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      let fullContent = "";
      for await (const chunk of readSSEEvents(response.body, signal)) {
        const choices = chunk.choices as Record<string, unknown>[] | undefined;
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
        if (delta?.content) fullContent += delta.content;
      }
      const promptTokens = Math.ceil(fullContent.length / 4);
      const completionTokens = Math.ceil(fullContent.length / 4);
      finalResponse = new Response(JSON.stringify({
        id: cid, object: "chat.completion", created, model, system_fingerprint: null,
        choices: [{ index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return { response: finalResponse, url: THEOLDLLM_API, headers, transformedBody: payload };
  }
}

export default TheOldLLMExecutor;
