import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

const GROK_CHAT_API = PROVIDERS["grok-web"].baseUrl as string;
const GROK_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface GrokModelInfo {
  grokModel: string;
  modelMode: string;
  isThinking: boolean;
}

const MODEL_MAP: Record<string, GrokModelInfo> = {
  "grok-3": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3", isThinking: false },
  "grok-3-mini": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3_MINI_THINKING", isThinking: true },
  "grok-3-thinking": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3_THINKING", isThinking: true },
  "grok-4": { grokModel: "grok-4", modelMode: "MODEL_MODE_GROK_4", isThinking: false },
  "grok-4-mini": { grokModel: "grok-4-mini", modelMode: "MODEL_MODE_GROK_4_MINI_THINKING", isThinking: true },
  "grok-4-thinking": { grokModel: "grok-4", modelMode: "MODEL_MODE_GROK_4_THINKING", isThinking: true },
  "grok-4-heavy": { grokModel: "grok-4", modelMode: "MODEL_MODE_HEAVY", isThinking: true },
  "grok-4.1-mini": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_MINI_THINKING", isThinking: true },
  "grok-4.1-fast": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_FAST", isThinking: false },
  "grok-4.1-expert": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_EXPERT", isThinking: true },
  "grok-4.1-thinking": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_THINKING", isThinking: true },
  "grok-4.2": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20-beta": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
};

function randomString(length: number, alphanumeric = false) {
  const chars = alphanumeric ? "abcdefghijklmnopqrstuvwxyz0123456789" : "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function generateStatsigId() {
  const msg = Math.random() < 0.5
    ? `e:TypeError: Cannot read properties of null (reading 'children["${randomString(5, true)}"]')`
    : `e:TypeError: Cannot read properties of undefined (reading '${randomString(10)}')`;
  return btoa(msg);
}

function randomHex(bytes: number) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b: number) => b.toString(16).padStart(2, "0")).join("");
}

function parseOpenAIMessages(messages: Record<string, unknown>[]) {
  const extracted: { role: string; text: string }[] = [];
  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => String(c.text || "")).join(" ");
    }
    if (!content.trim()) continue;
    extracted.push({ role, text: content });
  }

  let lastUserIdx = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") { lastUserIdx = i; break; }
  }

  const parts: string[] = [];
  for (let i = 0; i < extracted.length; i++) {
    const { role, text } = extracted[i];
    parts.push(i === lastUserIdx ? text : `${role}: ${text}`);
  }
  return parts.join("\n\n");
}

interface GrokChunk {
  delta?: string;
  thinking?: string;
  fullMessage?: string;
  fingerprint?: string;
  responseId?: string;
  error?: string;
  done?: boolean;
}

async function* readGrokNdjsonEvents(body: ReadableStream, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
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

async function* extractContent(eventStream: ReadableStream, isThinkingModel: boolean, signal?: AbortSignal): AsyncGenerator<GrokChunk> {
  let fingerprint = "";
  let responseId = "";

  for await (const event of readGrokNdjsonEvents(eventStream, signal)) {
    if (event.error) {
      yield { error: (event.error as Record<string, unknown>)?.message as string || `Grok error: ${(event.error as Record<string, unknown>)?.code}`, done: true };
      return;
    }
    const resp = (event.result as Record<string, unknown>)?.response as Record<string, unknown> | undefined;
    if (!resp) continue;

    if ((resp.llmInfo as Record<string, unknown>)?.modelHash && !fingerprint) fingerprint = (resp.llmInfo as Record<string, unknown>).modelHash as string;
    if (resp.responseId) responseId = resp.responseId as string;

    if (resp.modelResponse) {
      const mr = resp.modelResponse as Record<string, unknown>;
      if (isThinkingModel) {
        if (mr.message) yield { thinking: mr.message as string };
      }
      if (mr.message) yield { fullMessage: mr.message as string, fingerprint, responseId };
      if ((mr.metadata as Record<string, unknown>)?.llm_info) fingerprint = ((mr.metadata as Record<string, unknown>).llm_info as Record<string, unknown>).modelHash as string || fingerprint;
      continue;
    }

    if (resp.token != null) yield { delta: resp.token as string, fingerprint, responseId };
  }
  yield { done: true, fingerprint, responseId };
}

function buildStreamingResponse(eventStream: ReadableStream, model: string, cid: string, created: number, isThinkingModel: boolean, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        let fp = "";
        for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
          if (chunk.fingerprint) fp = chunk.fingerprint;

          if (chunk.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content: `[Error: ${chunk.error}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }
          if (chunk.thinking) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { reasoning_content: chunk.thinking }, finish_reason: null, logprobs: null }],
            })));
            continue;
          }
          if (chunk.done) break;
          if (chunk.delta) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null, logprobs: null }],
            })));
          }
        }

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
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

async function buildNonStreamingResponse(eventStream: ReadableStream, model: string, cid: string, created: number, isThinkingModel: boolean, signal?: AbortSignal) {
  let fullContent = "";
  let fingerprint = "";
  const thinkingParts: string[] = [];

  for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
    if (chunk.fingerprint) fingerprint = chunk.fingerprint;
    if (chunk.error) {
      return new Response(JSON.stringify({
        error: { message: chunk.error, type: "upstream_error", code: "GROK_ERROR" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (chunk.thinking) { thinkingParts.push(chunk.thinking); continue; }
    if (chunk.done) break;
    if (chunk.fullMessage) fullContent = chunk.fullMessage;
    else if (chunk.delta) fullContent += chunk.delta;
  }

  const msg: Record<string, unknown> = { role: "assistant", content: fullContent };
  if (thinkingParts.length > 0) (msg as Record<string, unknown>).reasoning_content = thinkingParts.join("\n");

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: fingerprint || null,
    choices: [{ index: 0, message: msg, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class GrokWebExecutor extends BaseExecutor {
  constructor() {
    super("grok-web", PROVIDERS["grok-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const modelInfo = MODEL_MAP[model];
    if (!modelInfo) log?.info?.("GROK-WEB", `Unmapped model ${model}, defaulting to grok-4.1-fast`);
    const { grokModel, modelMode, isThinking } = modelInfo || MODEL_MAP["grok-4.1-fast"];

    const message = parseOpenAIMessages(messages);
    if (!message.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const grokPayload: Record<string, unknown> = {
      temporary: true, modelName: grokModel, modelMode, message,
      fileAttachments: [], imageAttachments: [],
      disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
      returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
      forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
      isReasoning: false, disableTextFollowUps: false, disableMemory: true,
      forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
      deviceEnvInfo: {
        darkModeEnabled: false, devicePixelRatio: 2,
        screenWidth: 2056, screenHeight: 1329, viewportWidth: 2056, viewportHeight: 1083,
      },
    };

    const traceId = randomHex(16);
    const spanId = randomHex(8);
    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      Baggage: "sentry-environment=production,sentry-release=d6add6fb0460641fd482d767a335ef72b9b6abb8,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://grok.com",
      Pragma: "no-cache",
      Referer: "https://grok.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": GROK_USER_AGENT,
      "x-statsig-id": generateStatsigId(),
      "x-xai-request-id": crypto.randomUUID(),
      traceparent: `00-${traceId}-${spanId}-00`,
    };

    // Strip "sso=" prefix if user pasted it
    if (credentials.apiKey) {
      let token = credentials.apiKey;
      if (token.startsWith("sso=")) token = token.slice(4);
      headers["Cookie"] = `sso=${token}`;
    }

    log?.info?.("GROK-WEB", `Query to ${model} (grok=${grokModel}, mode=${modelMode}), len=${message.length}`);

    let response: Response;
    try {
      response = await fetch(GROK_CHAT_API, {
        method: "POST", headers, body: JSON.stringify(grokPayload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("GROK-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Grok connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Grok returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Grok auth failed — SSO cookie may be expired. Re-paste your sso cookie value from grok.com.";
      else if (status === 429) errMsg = "Grok rate limited. Wait a moment and retry, or rotate cookies.";
      log?.warn?.("GROK-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Grok returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    const cid = `chatcmpl-grok-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse: Response;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, isThinking, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, isThinking, signal);
    }
    return { response: finalResponse, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
  }
}

export default GrokWebExecutor;
