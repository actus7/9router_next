import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const BLACKBOX_API = PROVIDERS["blackbox-web"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function parseOpenAIMessages(messages: Record<string, unknown>[]): { systemPrompt: string; userMessage: string } {
  let systemPrompt = "";
  const userParts: string[] = [];

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
      systemPrompt += (systemPrompt ? "\n" : "") + content;
    } else {
      userParts.push(content);
    }
  }

  return { systemPrompt, userMessage: userParts.join("\n\n") };
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

            // Blackbox streams as plain text chunks or newline-delimited
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              // Try SSE format first
              if (trimmed.startsWith("data:")) {
                const data = trimmed.slice(5).trim();
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data) as Record<string, unknown>;
                  const content = (parsed.text as string) || (parsed.content as string) || "";
                  if (content) {
                    controller.enqueue(encoder.encode(sseChunk({
                      id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                      choices: [{ index: 0, delta: { content }, finish_reason: null, logprobs: null }],
                    })));
                  }
                } catch { /* skip */ }
              } else {
                // Plain text streaming
                controller.enqueue(encoder.encode(sseChunk({
                  id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                  choices: [{ index: 0, delta: { content: trimmed }, finish_reason: null, logprobs: null }],
                })));
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
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const content = (parsed.text as string) || (parsed.content as string) || "";
            if (content) fullContent += content;
          } catch { /* skip */ }
        } else {
          fullContent += trimmed;
        }
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

export class BlackboxWebExecutor extends BaseExecutor {
  constructor() {
    super("blackbox-web", PROVIDERS["blackbox-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: BLACKBOX_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const { systemPrompt, userMessage } = parseOpenAIMessages(messages);
    if (!userMessage.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: BLACKBOX_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const bbPayload: Record<string, unknown> = {
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userMessage },
      ],
      agentMode: {},
      id: crypto.randomUUID(),
      previewToken: null,
      userId: null,
      codeModelMode: false,
      trendingAgentMode: {},
      isMicMode: false,
      userSystemPrompt: systemPrompt || null,
      maxTokens: 4096,
      playgroundTemperature: 0.7,
      playgroundTopP: 0.9,
      isChromeExt: false,
      githubToken: "",
    };

    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://www.blackbox.ai",
      Pragma: "no-cache",
      Referer: "https://www.blackbox.ai/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
    };

    if (credentials.apiKey) {
      headers["Cookie"] = `__Secure-authjs.session-token=${credentials.apiKey}`;
    }

    log?.info?.("BLACKBOX-WEB", `Query to ${model}, msgs=${messages.length}`);

    let response: Response;
    try {
      response = await fetch(BLACKBOX_API, {
        method: "POST", headers, body: JSON.stringify(bbPayload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("BLACKBOX-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Blackbox connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: BLACKBOX_API, headers, transformedBody: bbPayload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Blackbox returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Blackbox auth failed — session token may be expired.";
      else if (status === 429) errMsg = "Blackbox rate limited. Wait a moment and retry.";
      log?.warn?.("BLACKBOX-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: BLACKBOX_API, headers, transformedBody: bbPayload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Blackbox returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: BLACKBOX_API, headers, transformedBody: bbPayload };
    }

    const cid = `chatcmpl-bb-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created);
    }
    return { response: finalResponse, url: BLACKBOX_API, headers, transformedBody: bbPayload };
  }
}

export default BlackboxWebExecutor;
