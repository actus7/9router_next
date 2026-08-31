import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

// ZenMux Free's real endpoint is Anthropic-Messages-API-shaped, not OpenAI —
// our previous executor posted an OpenAI body to a nonexistent
// /api/v1/chat/completions path and expected OpenAI SSE back.
const ZENMUX_API = PROVIDERS["zenmux-free"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function extractCtoken(cookieStr: string): string {
  const m = cookieStr.match(/ctoken=([^;]+)/);
  return m ? m[1] : "";
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: Record<string, unknown>) => c.type === "text")
      .map((c: Record<string, unknown>) => String(c.text || ""))
      .join(" ");
  }
  return content == null ? "" : JSON.stringify(content);
}

export class ZenmuxFreeExecutor extends BaseExecutor {
  constructor() {
    super("zenmux-free", PROVIDERS["zenmux-free"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: ZENMUX_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const rawCookie = (credentials.apiKey || "").trim();
    const ctoken = extractCtoken(rawCookie);
    if (!ctoken) {
      const errResp = new Response(JSON.stringify({
        error: { message: "ZenMux Free: ctoken not found in cookies. Export all cookies from zenmux.ai and paste as the credential.", type: "invalid_request", code: "missing_ctoken" },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: ZENMUX_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    // ZenMux's upstream flattens to a single user turn — collapse system +
    // last-user content, matching the real client's own request shape.
    const userMessages = messages.filter((m) => m.role === "user");
    const sysMessages = messages.filter((m) => m.role === "system");
    const lastUser = userMessages[userMessages.length - 1];
    const userText = messageText(lastUser?.content) || "Hello";
    const sysText = sysMessages.length > 0 ? messageText(sysMessages[0].content) : null;
    const fullText = sysText ? `${sysText}\n\n${userText}` : userText;

    const anthropicBody: Record<string, unknown> = {
      model,
      max_tokens: (body.max_tokens as number) || 4096,
      messages: [{ role: "user", content: [{ type: "text", text: fullText }] }],
      stream: true,
    };
    if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;

    const url = new URL(ZENMUX_API);
    url.searchParams.set("ctoken", ctoken);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "text/event-stream",
      Origin: "https://zenmux.ai",
      Referer: "https://zenmux.ai/platform/chat",
      "anthropic-version": "2023-06-01",
      "chat-request-id": crypto.randomUUID().replace(/-/g, ""),
      "x-zenmux-accept-processing": "true, true",
      "x-zenmux-apikey-source": "subscription",
      Cookie: rawCookie,
    };

    log?.info?.("ZENMUX-FREE", `Query to ${model}, stream=${stream}`);

    let response: Response;
    try {
      response = await fetch(url.toString(), { method: "POST", headers, body: JSON.stringify(anthropicBody), signal });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("ZENMUX-FREE", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `ZenMux connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: ZENMUX_API, headers, transformedBody: anthropicBody };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `ZenMux returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "ZenMux auth failed — cookies expired or invalid. Re-export your cookies from zenmux.ai.";
      else if (status === 402) errMsg = "ZenMux free-tier quota exhausted.";
      else if (status === 429) errMsg = "ZenMux rate limited. Wait a moment and retry.";
      log?.warn?.("ZENMUX-FREE", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: ZENMUX_API, headers, transformedBody: anthropicBody };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "ZenMux returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: ZENMUX_API, headers, transformedBody: anthropicBody };
    }

    const cid = `chatcmpl-zmf-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = translateAnthropicStream(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      const fullText = await collectAnthropicText(response.body);
      finalResponse = new Response(JSON.stringify({
        id: cid, object: "chat.completion", created, model, system_fingerprint: null,
        choices: [{ index: 0, message: { role: "assistant", content: fullText }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: 0, completion_tokens: Math.ceil(fullText.length / 4), total_tokens: Math.ceil(fullText.length / 4) },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return { response: finalResponse, url: ZENMUX_API, headers, transformedBody: anthropicBody };
  }
}

/** Read Anthropic Messages-API SSE (`content_block_delta` / `message_delta`),
 * yielding parsed event objects. */
async function* readAnthropicEvents(body: ReadableStream, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data: ")) continue;
        const raw = t.slice(6);
        if (raw === "[DONE]") return;
        try { yield JSON.parse(raw) as Record<string, unknown>; } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractAnthropicDeltaText(evt: Record<string, unknown>): string {
  if (evt.type !== "content_block_delta") return "";
  const delta = evt.delta as Record<string, unknown> | undefined;
  return (delta?.text as string) || (delta?.thinking as string) || "";
}

function translateAnthropicStream(body: ReadableStream, model: string, cid: string, created: number, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        for await (const evt of readAnthropicEvents(body, signal)) {
          const text = extractAnthropicDeltaText(evt);
          if (text) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }],
            })));
            continue;
          }
          if (evt.type === "message_delta") {
            const delta = evt.delta as Record<string, unknown> | undefined;
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: (delta?.stop_reason as string) || "stop", logprobs: null }],
            })));
          }
        }
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

async function collectAnthropicText(body: ReadableStream): Promise<string> {
  let text = "";
  for await (const evt of readAnthropicEvents(body)) {
    text += extractAnthropicDeltaText(evt);
  }
  return text;
}

export default ZenmuxFreeExecutor;
