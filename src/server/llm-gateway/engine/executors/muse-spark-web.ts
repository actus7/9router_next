import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const META_API = PROVIDERS["muse-spark-web"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function parseOpenAIMessages(messages: Record<string, unknown>[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c: Record<string, unknown>) => c.type === "text")
        .map((c: Record<string, unknown>) => String(c.text || ""))
        .join(" ");
    }
    if (!content.trim()) continue;
    if (role === "system") {
      parts.push(`[System]: ${content}`);
    } else {
      parts.push(content);
    }
  }
  return parts.join("\n\n");
}

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

              // Meta AI GraphQL streaming — look for text deltas in response
              if (trimmed.startsWith("data:")) {
                const data = trimmed.slice(5).trim();
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data) as Record<string, unknown>;
                  // Meta AI response shape: extract streaming text
                  const delta = (parsed.delta as string) || (parsed.text as string) || (parsed.content as string) || "";
                  if (delta) {
                    controller.enqueue(encoder.encode(sseChunk({
                      id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                      choices: [{ index: 0, delta: { content: delta }, finish_reason: null, logprobs: null }],
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
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const delta = (parsed.delta as string) || (parsed.text as string) || (parsed.content as string) || "";
          if (delta) fullContent += delta;
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

export class MuseSparkWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-spark-web", PROVIDERS["muse-spark-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: META_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const query = parseOpenAIMessages(messages);
    if (!query.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: META_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const graphqlQuery = `query FetchBotMessage($query: String!, $context: String) {
      fetchBotMessage(query: $query, context: $context) {
        message { text }
      }
    }`;

    const metaPayload = {
      query: graphqlQuery,
      variables: { query, context: null },
    };

    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://www.meta.ai",
      Pragma: "no-cache",
      Referer: "https://www.meta.ai/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
    };

    if (credentials.apiKey) {
      headers["Cookie"] = `ecto_1_sess=${credentials.apiKey}`;
    }

    log?.info?.("MUSE-SPARK-WEB", `Query to ${model}, len=${query.length}`);

    let response: Response;
    try {
      response = await fetch(META_API, {
        method: "POST", headers, body: JSON.stringify(metaPayload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("MUSE-SPARK-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Meta AI connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: META_API, headers, transformedBody: metaPayload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Meta AI returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Meta AI auth failed — ecto_1_sess cookie may be expired.";
      else if (status === 429) errMsg = "Meta AI rate limited. Wait a moment and retry.";
      log?.warn?.("MUSE-SPARK-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: META_API, headers, transformedBody: metaPayload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Meta AI returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: META_API, headers, transformedBody: metaPayload };
    }

    const cid = `chatcmpl-meta-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created);
    }
    return { response: finalResponse, url: META_API, headers, transformedBody: metaPayload };
  }
}

export default MuseSparkWebExecutor;
