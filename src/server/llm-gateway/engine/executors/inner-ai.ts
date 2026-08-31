import { createHash } from "node:crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

// Inner.ai's real API lives on chatapi.innerai.com / platformapi.innerai.com
// (not inner.ai) with a bespoke request/response shape — a single `message`
// string, dynamic model resolution against /ai_models, and custom SSE event
// types ({type:"text"|"end_stream"|"missing_credits"|...}), not the OpenAI
// {messages, model, stream} + choices[].delta shape our previous executor
// assumed.
const INNER_AI_CHAT_URL = PROVIDERS["inner-ai"].baseUrl as string;
const INNER_AI_PROFILE_URL = "https://platformapi.innerai.com/api/v1/users/profile";
const INNER_AI_MODELS_URL = "https://platformapi.innerai.com/api/v1/ai_models";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

interface InnerAiModel {
  id: string;
  llm_model: string;
  enable?: boolean;
  unavailable_api?: boolean;
  pro_only?: boolean;
  ultra_only?: boolean;
  ai_model_categories?: Array<Record<string, unknown>>;
}
interface CredentialCache {
  email: string;
  deviceId: string;
}

const credentialCache = new Map<string, CredentialCache>();
const modelsCache = new Map<string, { models: InnerAiModel[]; expiresAt: number }>();

function lruTouch<V>(map: Map<string, V>, key: string): V | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
}
function lruSet<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
function tokenCacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Accepts "token", "token user@example.com", or "token=... user@example.com". */
function parseCredential(rawApiKey: string): { token: string; credEmail: string } {
  const trimmed = rawApiKey.trim();
  const eqIdx = trimmed.indexOf("=");
  const stripped = eqIdx > 0 && !trimmed.startsWith("eyJ") ? trimmed.slice(eqIdx + 1).trim() : trimmed;
  const lastSpace = stripped.lastIndexOf(" ");
  if (lastSpace > 0) {
    const possibleEmail = stripped.slice(lastSpace + 1).trim();
    if (possibleEmail.includes("@")) return { token: stripped.slice(0, lastSpace).trim(), credEmail: possibleEmail };
  }
  return { token: stripped, credEmail: "" };
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
}

function buildHeaders(token: string, email: string, deviceId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Cookie: `token=${token}`,
    "USER-TOKEN": token,
    "DEVICE-ID": deviceId,
    Origin: "https://app.innerai.com",
    Referer: "https://app.innerai.com/",
  };
  if (email) headers["USER-EMAIL"] = email;
  return headers;
}

async function resolveCredentials(token: string, credEmail: string, signal?: AbortSignal): Promise<CredentialCache> {
  const key = tokenCacheKey(token);
  const cached = lruTouch(credentialCache, key);
  if (cached) return cached;

  const payload = decodeJwtPayload(token);
  const deviceId = String(payload?.device_id ?? payload?.deviceId ?? payload?.["device-id"] ?? payload?.did ?? "").trim();

  const profileHeaders: Record<string, string> = { Cookie: `token=${token}`, "USER-TOKEN": token, "User-Agent": USER_AGENT, Origin: "https://app.innerai.com", Referer: "https://app.innerai.com/" };
  if (deviceId) profileHeaders["DEVICE-ID"] = deviceId;

  let email = "";
  try {
    const profileResp = await fetch(INNER_AI_PROFILE_URL, { headers: profileHeaders, signal });
    if (profileResp.ok) {
      const b = await profileResp.json().catch(() => null) as Record<string, unknown> | null;
      email = String((b?.data as Record<string, unknown>)?.email ?? (b?.user as Record<string, unknown>)?.email ?? (b?.profile as Record<string, unknown>)?.email ?? b?.email ?? "").trim();
    }
  } catch { /* profile fetch failed — proceed without email */ }

  if (!email && credEmail) email = credEmail;
  if (!email && typeof payload?.sub === "string" && payload.sub.includes("@")) email = payload.sub;

  const creds: CredentialCache = { email, deviceId };
  lruSet(credentialCache, key, creds);
  return creds;
}

class InnerAiModelsError extends Error {
  constructor(public readonly status: number) {
    super(`Inner.ai /ai_models returned HTTP ${status}`);
    this.name = "InnerAiModelsError";
  }
}

async function resolveModels(token: string, deviceId: string, email: string, signal?: AbortSignal): Promise<InnerAiModel[]> {
  const key = tokenCacheKey(token);
  const cached = lruTouch(modelsCache, key);
  if (cached && Date.now() < cached.expiresAt) return cached.models;

  const resp = await fetch(INNER_AI_MODELS_URL, { headers: buildHeaders(token, email, deviceId), signal });
  if (!resp.ok) {
    const err = new InnerAiModelsError(resp.status);
    if (resp.status === 401 || resp.status === 403) credentialCache.delete(tokenCacheKey(token));
    throw err;
  }

  const body = await resp.json().catch(() => null);
  let raw: InnerAiModel[] = [];
  if (Array.isArray(body)) raw = body as InnerAiModel[];
  else if (Array.isArray((body as Record<string, unknown>)?.data)) raw = (body as Record<string, unknown>).data as InnerAiModel[];
  else if (Array.isArray((body as Record<string, unknown>)?.ai_models)) raw = (body as Record<string, unknown>).ai_models as InnerAiModel[];

  const planRaw = String(decodeJwtPayload(token)?.plan ?? decodeJwtPayload(token)?.tier ?? decodeJwtPayload(token)?.subscription ?? "").toLowerCase();
  const isUltra = planRaw.includes("ultra") || planRaw.includes("enterprise");
  const isPro = isUltra || planRaw.includes("pro") || planRaw.includes("plus");

  const nonTextPattern = /image|video|audio|img|vid|sound|music|voice|tts|stt|track|clip|avatar|cartoon|flux|stable.diff|recraft|ideogram|leonardo|magnific|bria|seedream|luma|kling|pika|veo|wan-|heygen|did-|vidu|pixverse|sora-|gen-[0-9]|playground|gemini-fal|gamma|lyria|clothes|whisper/i;
  const models = raw.filter((m) => {
    if (m.enable === false || m.unavailable_api) return false;
    if (m.ultra_only && !isUltra) return false;
    if (m.pro_only && !isPro) return false;
    const cats = Array.isArray(m.ai_model_categories) ? m.ai_model_categories : null;
    if (cats && cats.length > 0) {
      return cats.some((c) => String((c as Record<string, unknown>).unique_identifier ?? (c as Record<string, unknown>).name ?? "").toLowerCase() === "text");
    }
    return !nonTextPattern.test(m.llm_model);
  });

  lruSet(modelsCache, key, { models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS });
  return models;
}

/** First match wins: exact → case-insensitive → substring. Returns null so the
 * caller sends the requested model verbatim (a meaningful upstream 4xx) rather
 * than silently rerouting every unmatched model to the first available one. */
function findModel(models: InnerAiModel[], requestedId: string): InnerAiModel | null {
  if (models.length === 0) return null;
  const lower = requestedId.toLowerCase();
  return models.find((m) => m.llm_model === requestedId) ?? models.find((m) => m.llm_model.toLowerCase() === lower) ?? models.find((m) => m.llm_model.toLowerCase().includes(lower)) ?? null;
}

/** Inner.ai takes a single `message` string, not a messages[] array. */
function buildMessageContent(messages: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content
      : Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>).filter((c) => c?.type === "text").map((c) => String(c.text ?? "")).join("")
      : "";
    if (!content.trim()) continue;
    if (msg.role === "system") parts.push(`[Instructions]\n${content}`);
    else if (msg.role === "assistant") parts.push(`[Assistant]\n${content}`);
    else parts.push(content);
  }
  return parts.join("\n\n");
}

function rateLimitMessage(type: string): string {
  if (type === "missing_credits") return "Inner.ai: not enough credits";
  if (type === "reached_limit") return "Inner.ai: usage limit reached";
  return "Inner.ai: rate limit reached — try again later";
}
const RATE_LIMIT_TYPES = new Set(["missing_credits", "reached_limit", "rate_limit_reached", "rate_limit_longer_reached"]);

function transformInnerAiSSE(upstream: ReadableStream, model: string): ReadableStream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let emittedRole = false;

  const chunkEvent = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            let data: Record<string, unknown>;
            try { data = JSON.parse(jsonStr); } catch { continue; }
            const type = String(data.type ?? "");
            const item = String(data.item ?? "");

            if (type === "text") {
              if (!item) continue;
              if (!emittedRole) { emittedRole = true; controller.enqueue(encoder.encode(chunkEvent({ role: "assistant", content: "" }))); }
              controller.enqueue(encoder.encode(chunkEvent({ content: item })));
            } else if (type === "end_stream") {
              if (!emittedRole) { emittedRole = true; controller.enqueue(encoder.encode(chunkEvent({ role: "assistant", content: "" }))); }
              controller.enqueue(encoder.encode(chunkEvent({}, "stop")));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            } else if (RATE_LIMIT_TYPES.has(type)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: rateLimitMessage(type), type: "rate_limit_error", code: type } })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
            // type === "status" (e.g. provider_timeout_retry) → ignore
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err || "Stream error");
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message, type: "upstream_error" } })}\n\n`));
      }
      if (!emittedRole) controller.enqueue(encoder.encode(chunkEvent({ role: "assistant", content: "" })));
      controller.enqueue(encoder.encode(chunkEvent({}, "stop")));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

class InnerAiStreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "InnerAiStreamError";
  }
}

async function collectContent(upstream: ReadableStream): Promise<string> {
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      let data: Record<string, unknown>;
      try { data = JSON.parse(jsonStr); } catch { continue; }
      const type = data.type as string;
      if (type === "text" && typeof data.item === "string") { content += data.item; continue; }
      if (RATE_LIMIT_TYPES.has(type)) throw new InnerAiStreamError(429, rateLimitMessage(type));
    }
  }
  return content;
}

export class InnerAiExecutor extends BaseExecutor {
  constructor() {
    super("inner-ai", PROVIDERS["inner-ai"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const rawToken = (credentials.apiKey || "").trim();
    if (!rawToken) {
      return { response: errorResponse(401, "Missing Inner.ai token — paste your token cookie from DevTools → Application → Cookies → .innerai.com"), url: INNER_AI_CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }
    const { token, credEmail } = parseCredential(rawToken);

    let creds: CredentialCache;
    try {
      creds = await resolveCredentials(token, credEmail, signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to authenticate with Inner.ai";
      credentialCache.delete(tokenCacheKey(token));
      return { response: errorResponse(401, msg), url: INNER_AI_CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }
    const { email, deviceId } = creds;

    const requestedModel = model || "gpt-4o";
    let models: InnerAiModel[] = [];
    try {
      models = await resolveModels(token, deviceId, email, signal);
    } catch (err) {
      if (err instanceof InnerAiModelsError && (err.status === 401 || err.status === 403)) {
        return { response: errorResponse(err.status, "Inner.ai /ai_models authentication failed — re-paste your token cookie"), url: INNER_AI_CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
      }
      log?.warn?.("INNER-AI", `/ai_models fetch failed — falling back to synthetic model entry`);
    }

    const modelEntry: InnerAiModel = findModel(models, requestedModel) ?? { id: "", llm_model: requestedModel };

    const messages = (Array.isArray(body?.messages) ? body.messages : []) as Array<Record<string, unknown>>;
    const messageContent = buildMessageContent(messages);
    if (!messageContent.trim()) {
      return { response: errorResponse(400, "No message content to send"), url: INNER_AI_CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const innerAiBody = {
      message: messageContent,
      session_id: crypto.randomUUID(),
      context_type: "no_context",
      ai_model: { id: modelEntry?.id || undefined, llm_model: modelEntry?.llm_model ?? requestedModel },
      is_extension: false,
      env: "production",
      temporary: true,
      use_web_search: false,
      knowledge_list: [],
    };
    const reqHeaders = buildHeaders(token, email, deviceId);

    log?.info?.("INNER-AI", `Query to ${modelEntry?.llm_model ?? requestedModel}, stream=${stream}`);

    let upstream: Response;
    try {
      upstream = await fetch(INNER_AI_CHAT_URL, { method: "POST", headers: reqHeaders, body: JSON.stringify(innerAiBody), signal });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Request failed";
      return { response: errorResponse(502, `Inner.ai request failed: ${errMsg}`), url: INNER_AI_CHAT_URL, headers: reqHeaders, transformedBody: innerAiBody };
    }

    if (upstream.status === 401 || upstream.status === 403) {
      credentialCache.delete(tokenCacheKey(token));
      return { response: errorResponse(upstream.status, "Inner.ai authentication failed — re-paste your token cookie"), url: INNER_AI_CHAT_URL, headers: reqHeaders, transformedBody: innerAiBody };
    }
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return { response: errorResponse(upstream.status, `Inner.ai returned HTTP ${upstream.status}: ${errText.slice(0, 200)}`), url: INNER_AI_CHAT_URL, headers: reqHeaders, transformedBody: innerAiBody };
    }
    if (!upstream.body) {
      return { response: errorResponse(502, "Inner.ai returned an empty response"), url: INNER_AI_CHAT_URL, headers: reqHeaders, transformedBody: innerAiBody };
    }

    const resolvedModel = modelEntry?.llm_model ?? requestedModel;

    if (stream !== false) {
      return {
        response: new Response(transformInnerAiSSE(upstream.body, resolvedModel), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: INNER_AI_CHAT_URL, headers: reqHeaders, transformedBody: innerAiBody,
      };
    }

    let content: string;
    try {
      content = await collectContent(upstream.body);
    } catch (err) {
      if (err instanceof InnerAiStreamError) {
        return { response: errorResponse(err.status, err.message), url: INNER_AI_CHAT_URL, headers: reqHeaders, transformedBody: innerAiBody };
      }
      throw err;
    }

    return {
      response: new Response(JSON.stringify({
        id: `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: resolvedModel,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { headers: { "Content-Type": "application/json" } }),
      url: INNER_AI_CHAT_URL, headers: reqHeaders, transformedBody: innerAiBody,
    };
  }
}

export default InnerAiExecutor;
