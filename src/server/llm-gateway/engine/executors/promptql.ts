import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const API_URL = PROVIDERS["promptql"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function buildStreamingResponse(body: ReadableStream, model: string, cid: string, created: number, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            if (signal?.aborted) break;
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              // Try SSE format first
              if (trimmed.startsWith("data: ")) {
                const payload = trimmed.slice(6);
                if (payload === "[DONE]") continue;
                try {
                  const chunk = JSON.parse(payload);
                  // GraphQL streaming may wrap in { data: { ... } }
                  const text = chunk?.data?.chat?.message || chunk?.data?.message || chunk?.choices?.[0]?.delta?.content;
                  if (text) {
                    controller.enqueue(encoder.encode(sseChunk({
                      id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                      choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }],
                    })));
                  }
                } catch { /* skip malformed */ }
              } else {
                // Try NDJSON
                try {
                  const chunk = JSON.parse(trimmed);
                  const text = chunk?.data?.chat?.message || chunk?.data?.message || chunk?.choices?.[0]?.delta?.content;
                  if (text) {
                    controller.enqueue(encoder.encode(sseChunk({
                      id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                      choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }],
                    })));
                  }
                } catch { /* skip */ }
              }
            }
          }
        } finally {
          reader.releaseLock();
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

async function buildNonStreamingResponse(body: ReadableStream, model: string, cid: string, created: number) {
  let fullContent = "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed);
          const text = chunk?.data?.chat?.message || chunk?.data?.message || chunk?.choices?.[0]?.delta?.content;
          if (text) fullContent += text;
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);
  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content: fullContent }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class PromptQLExecutor extends BaseExecutor {
  constructor() {
    super("promptql", PROVIDERS["promptql"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: API_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://promptql.com",
      Pragma: "no-cache",
      Referer: "https://promptql.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
    };

    // PromptQL uses Bearer JWT auth
    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    // Build GraphQL payload
    const lastUserMsg = messages.filter((m: Record<string, unknown>) => m.role === "user").pop();
    const userText = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.content)
        ? (lastUserMsg.content as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => String(c.text || "")).join(" ")
        : "";

    const payload: Record<string, unknown> = {
      query: `mutation Chat($input: ChatInput!) { chat(input: $input) { message } }`,
      variables: {
        input: {
          message: userText,
          model: model === "promptql-default" ? "default" : model,
        },
      },
    };

    log?.info?.("PROMPTQL", `Query to ${model}, stream=${stream}, msgs=${messages.length}`);

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST", headers, body: JSON.stringify(payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("PROMPTQL", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `PromptQL connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: API_URL, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `PromptQL returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "PromptQL auth failed — JWT may be expired. Re-paste your Bearer JWT from promptql.com.";
      else if (status === 429) errMsg = "PromptQL rate limited. Wait a moment and retry.";
      log?.warn?.("PROMPTQL", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: API_URL, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "PromptQL returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: API_URL, headers, transformedBody: payload };
    }

    const cid = `chatcmpl-pql-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created);
    }
    return { response: finalResponse, url: API_URL, headers, transformedBody: payload };
  }
}

export default PromptQLExecutor;
