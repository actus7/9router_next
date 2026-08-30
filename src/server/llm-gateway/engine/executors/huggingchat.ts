import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const HUGGINGCHAT_API = PROVIDERS["huggingchat"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function parseOpenAIMessages(messages: Record<string, unknown>[]): { system: string; userMessages: { role: string; content: string }[] } {
  let system = "";
  const userMessages: { role: string; content: string }[] = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => String(c.text || "")).join(" ");
    }
    if (!content.trim()) continue;
    if (role === "system") {
      system = content;
    } else {
      userMessages.push({ role, content });
    }
  }
  return { system, userMessages };
}

async function* readNdjsonEvents(body: ReadableStream, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
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
        if (!line) continue;
        try { yield JSON.parse(line) as Record<string, unknown>; } catch { /* skip */ }
      }
    }
    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining) {
      try { yield JSON.parse(remaining) as Record<string, unknown>; } catch { /* skip */ }
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

        for await (const event of readNdjsonEvents(eventStream, signal)) {
          if (event.type === "stream" && typeof event.token === "string") {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: event.token }, finish_reason: null, logprobs: null }],
            })));
          }
          if (event.type === "finalAnswer" && typeof event.text === "string") {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: event.text }, finish_reason: null, logprobs: null }],
            })));
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

async function buildNonStreamingResponse(eventStream: ReadableStream, model: string, cid: string, created: number, signal?: AbortSignal) {
  let fullContent = "";
  for await (const event of readNdjsonEvents(eventStream, signal)) {
    if (event.type === "stream" && typeof event.token === "string") fullContent += event.token;
    if (event.type === "finalAnswer" && typeof event.text === "string") fullContent += event.text;
  }

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class HuggingChatExecutor extends BaseExecutor {
  constructor() {
    super("huggingchat", PROVIDERS["huggingchat"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: HUGGINGCHAT_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const { system, userMessages } = parseOpenAIMessages(messages);
    if (userMessages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: HUGGINGCHAT_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://huggingface.co",
      Referer: "https://huggingface.co/chat/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
    };

    if (credentials.apiKey) {
      headers["Cookie"] = `hf-chat=${credentials.apiKey}`;
    }

    // HuggingChat uses its own body format
    const lastUser = userMessages[userMessages.length - 1];
    const payload: Record<string, unknown> = {
      model,
      inputs: lastUser.content,
      parameters: {
        max_new_tokens: 1024,
        return_full_text: false,
      },
    };

    if (system) {
      (payload.parameters as Record<string, unknown>).system_prompt = system;
    }

    log?.info?.("HUGGINGCHAT", `Query to ${model}, stream=${stream}`);

    let response: Response;
    try {
      response = await fetch(HUGGINGCHAT_API, {
        method: "POST", headers, body: JSON.stringify(payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("HUGGINGCHAT", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `HuggingChat connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: HUGGINGCHAT_API, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `HuggingChat returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "HuggingChat auth failed — hf-chat cookie may be expired. Re-paste your cookie from huggingface.co/chat.";
      else if (status === 429) errMsg = "HuggingChat rate limited. Wait a moment and retry.";
      log?.warn?.("HUGGINGCHAT", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: HUGGINGCHAT_API, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "HuggingChat returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: HUGGINGCHAT_API, headers, transformedBody: payload };
    }

    const cid = `chatcmpl-hc-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, signal);
    }
    return { response: finalResponse, url: HUGGINGCHAT_API, headers, transformedBody: payload };
  }
}

export default HuggingChatExecutor;
