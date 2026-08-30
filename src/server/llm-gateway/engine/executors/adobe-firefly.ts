import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const FIREFLY_API = PROVIDERS["adobe-firefly"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function extractPrompt(messages: Record<string, unknown>[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content.filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => String(c.text || "")).join(" ");
      }
    }
  }
  return "";
}

export class AdobeFireflyExecutor extends BaseExecutor {
  constructor() {
    super("adobe-firefly", PROVIDERS["adobe-firefly"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: FIREFLY_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const prompt = extractPrompt(messages);
    if (!prompt.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty prompt after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: FIREFLY_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://firefly.adobe.com",
      Referer: "https://firefly.adobe.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
    };

    // Support both cookie auth and Bearer JWT
    if (credentials.apiKey) {
      if (credentials.apiKey.startsWith("Bearer ") || credentials.apiKey.startsWith("eyJ")) {
        headers["Authorization"] = credentials.apiKey.startsWith("Bearer ") ? credentials.apiKey : `Bearer ${credentials.apiKey}`;
      } else {
        headers["Cookie"] = credentials.apiKey;
      }
    }

    const isVideo = model === "firefly-video";
    const fireflyPayload: Record<string, unknown> = {
      prompt,
      numVariations: 1,
      ...(isVideo ? { duration: 5 } : { width: 1024, height: 1024 }),
    };

    log?.info?.("ADOBE-FLY", `Query to ${model}, prompt len=${prompt.length}`);

    let response: Response;
    try {
      response = await fetch(FIREFLY_API, {
        method: "POST", headers, body: JSON.stringify(fireflyPayload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("ADOBE-FLY", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Adobe Firefly connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: FIREFLY_API, headers, transformedBody: fireflyPayload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Adobe Firefly returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Adobe Firefly auth failed — cookie/JWT may be expired. Re-paste your credentials from firefly.adobe.com.";
      else if (status === 429) errMsg = "Adobe Firefly rate limited. Wait a moment and retry.";
      log?.warn?.("ADOBE-FLY", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: FIREFLY_API, headers, transformedBody: fireflyPayload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Adobe Firefly returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: FIREFLY_API, headers, transformedBody: fireflyPayload };
    }

    // Read full response (Firefly returns JSON with image/video URLs)
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

    let resultData: Record<string, unknown>;
    try {
      resultData = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      const errResp = new Response(JSON.stringify({
        error: { message: "Failed to parse Adobe Firefly response", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: FIREFLY_API, headers, transformedBody: fireflyPayload };
    }

    const cid = `chatcmpl-afw-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    // Extract outputs from Firefly response
    const outputs = (resultData.outputs as Record<string, unknown>[]) || [];
    const imageUrls = outputs.map((o: Record<string, unknown>) => (o.image as Record<string, unknown>)?.url || (o.video as Record<string, unknown>)?.url || "").filter(Boolean);
    const contentText = imageUrls.length > 0
      ? `[${isVideo ? "Video" : "Image"} generated] URLs:\n${imageUrls.join("\n")}`
      : JSON.stringify(resultData);

    let finalResponse: Response;
    if (stream) {
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream({
        start(controller) {
          try {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
            })));
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: contentText }, finish_reason: null, logprobs: null }],
            })));
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
            })));
            controller.enqueue(encoder.encode(SSE_DONE));
          } finally {
            controller.close();
          }
        },
      });
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      const promptTokens = Math.ceil(prompt.length / 4);
      const completionTokens = Math.ceil(contentText.length / 4);
      finalResponse = new Response(JSON.stringify({
        id: cid, object: "chat.completion", created, model, system_fingerprint: null,
        choices: [{ index: 0, message: { role: "assistant", content: contentText }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return { response: finalResponse, url: FIREFLY_API, headers, transformedBody: fireflyPayload };
  }
}

export default AdobeFireflyExecutor;
