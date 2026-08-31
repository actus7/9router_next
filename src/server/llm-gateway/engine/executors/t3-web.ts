// t3.chat (t3.chat) executor.
//
// t3.chat is a TanStack Start app — completions go through `_serverFn/{hash}`
// endpoints using Turbo Stream Serialization (TSS), not plain OpenAI-shaped
// SSE. The previous version of this executor only understood
// `choices[0].delta.content` frames and silently dropped every TSS envelope
// (caught by the blanket `catch { skip }` around JSON.parse), producing an
// empty-but-"successful" completion. Ported from OmniRoute's t3-chat-web.ts.
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const T3_API = PROVIDERS["t3-web"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const TSS_ACCEPT = "application/x-tss-framed, application/x-ndjson, application/json";

interface T3Credentials {
  cookieHeader: string;
  convexSessionId: string;
}

/**
 * The credential pipeline stores the single pasted string as `credentials.apiKey`
 * (fallback `accessToken`), never pre-structured fields — parse it here instead.
 * Accepted forms:
 *   (a) "convex-session-id=abc; sessionToken=xyz"      — plain Cookie header
 *   (b) a full Cookie header that already contains convex-session-id=...
 *   (c) "cookies=<Cookie header>\nconvexSessionId=<id>" — structured form
 *   (d) a bare convex-session-id value (legacy — what this executor used to require)
 */
function parseT3Credentials(raw: string): T3Credentials {
  const trimmed = raw.trim();
  if (!trimmed) return { cookieHeader: "", convexSessionId: "" };

  let cookieHeader = trimmed;
  let convexSessionId = "";

  if (trimmed.includes("convexSessionId") || trimmed.includes("convex-session-id")) {
    const parts = trimmed.split(/[,;\n]/).map((s) => s.trim());
    const cookieParts: string[] = [];
    for (const part of parts) {
      if (part.startsWith("convexSessionId=") || part.startsWith("convex-session-id=")) {
        convexSessionId = part.split("=").slice(1).join("=");
      } else if (part.startsWith("cookies=")) {
        cookieParts.push(part.slice("cookies=".length));
      } else if (part.includes("=")) {
        cookieParts.push(part);
      }
    }
    if (cookieParts.length) cookieHeader = cookieParts.join("; ");
  } else if (!trimmed.includes(";") && !trimmed.includes("=")) {
    // Legacy bare-value paste — treat as the convex-session-id itself.
    convexSessionId = trimmed;
  }

  const finalCookie =
    convexSessionId && !cookieHeader.includes("convex-session-id")
      ? `${cookieHeader}; convex-session-id=${convexSessionId}`
      : cookieHeader;

  if (!convexSessionId) {
    const m = finalCookie.match(/convex-session-id=([^;]+)/);
    if (m) convexSessionId = m[1].trim();
  }

  return { cookieHeader: finalCookie, convexSessionId };
}

/**
 * Extract text from a TSS-encoded payload.
 * TSS types: t=0 number, t=2 string/enum, t=9 array, t=10 object, t=11 null.
 * Chat text typically arrives as a direct field, or nested in a t:10 envelope
 * under p.k (keys) / p.v (values).
 */
function extractTextFromTSS(data: Record<string, unknown>): string | null {
  if (typeof data?.text === "string") return data.text;
  if (typeof data?.delta === "string") return data.delta;
  if (typeof data?.content === "string") return data.content;

  const p = data?.p as { k?: unknown[]; v?: unknown[] } | undefined;
  if (p?.k && p?.v && Array.isArray(p.k) && Array.isArray(p.v)) {
    for (let i = 0; i < p.k.length; i++) {
      if (p.k[i] === "content" || p.k[i] === "text" || p.k[i] === "delta") {
        const val = p.v[i] as { t?: number; s?: string } | string | undefined;
        if (typeof val === "string") return val;
        if (val && typeof val === "object" && val.t === 2 && typeof val.s === "string") return val.s;
      }
    }
  }

  if (data?.t === 2 && typeof (data as Record<string, unknown>).s === "string") {
    return (data as Record<string, unknown>).s as string;
  }
  return null;
}

function isTSSDone(data: Record<string, unknown>): boolean {
  return (
    data?.type === "done" ||
    data?.done === true ||
    data?.status === "complete" ||
    data?.finish_reason === "stop"
  );
}

/** Also still understands plain OpenAI-shaped `choices[0].delta.content` frames,
 * in case a given t3.chat deployment answers with those instead of TSS. */
function extractDelta(parsed: Record<string, unknown>): string | null {
  const choices = parsed.choices as Record<string, unknown>[] | undefined;
  const openaiDelta = choices?.[0]?.delta as Record<string, unknown> | undefined;
  if (typeof openaiDelta?.content === "string") return openaiDelta.content;
  return extractTextFromTSS(parsed);
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
              // Accept both NDJSON (bare line) and SSE ("data: " prefix) framing.
              const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
              if (payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload) as Record<string, unknown>;
                const content = extractDelta(parsed);
                if (content) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { content }, finish_reason: null, logprobs: null }],
                  })));
                }
                if (isTSSDone(parsed)) {
                  buffer = "";
                  break;
                }
              } catch { /* skip malformed frame */ }
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
        const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>;
          const content = extractDelta(parsed);
          if (content) fullContent += content;
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

export class T3WebExecutor extends BaseExecutor {
  constructor() {
    super("t3-web", PROVIDERS["t3-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: T3_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const rawCredential = String(credentials.apiKey ?? credentials.accessToken ?? "");
    const parsedCreds = parseT3Credentials(rawCredential);
    if (!parsedCreds.cookieHeader || !parsedCreds.convexSessionId) {
      const errResp = new Response(JSON.stringify({
        error: { message: "t3.chat credentials invalid: paste your full Cookie header (including convex-session-id) from t3.chat.", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: T3_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const t3Payload: Record<string, unknown> = {
      messages,
      model: "t3-default",
      stream: true,
    };

    const headers: Record<string, string> = {
      Accept: TSS_ACCEPT,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Cookie: parsedCreds.cookieHeader,
      Origin: "https://t3.chat",
      Pragma: "no-cache",
      Referer: "https://t3.chat/",
      "Sec-Ch-Ua": '"Google Chrome";v="149", "Chromium";v="149", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": USER_AGENT,
    };

    log?.info?.("T3-WEB", `Query to ${model}, msgs=${messages.length}`);

    let response: Response;
    try {
      response = await fetch(T3_API, {
        method: "POST", headers, body: JSON.stringify(t3Payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("T3-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `t3.chat connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: T3_API, headers, transformedBody: t3Payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `t3.chat returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "t3.chat session expired or unauthorized — re-paste your full cookie header (including convex-session-id).";
      else if (status === 429) errMsg = "t3.chat rate limited. Wait a moment and retry.";
      log?.warn?.("T3-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: T3_API, headers, transformedBody: t3Payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "t3.chat returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: T3_API, headers, transformedBody: t3Payload };
    }

    const cid = `chatcmpl-t3-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, signal);
      finalResponse = new Response(sseStream, { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created);
    }
    return { response: finalResponse, url: T3_API, headers, transformedBody: t3Payload };
  }
}

export default T3WebExecutor;
