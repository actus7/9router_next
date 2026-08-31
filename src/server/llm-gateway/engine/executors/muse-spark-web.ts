import { createHash } from "node:crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";
import { META_AI_ROOT_BRANCH_PATH, META_WS_CHAT_TEMPLATE_B64, META_WS_HOME_TEMPLATE_B64, generateMetaConversationId } from "./muse-spark-web/wsFrames";
import { wsChat } from "./muse-spark-web/wsChat";

const META_AI_GRAPHQL_API = PROVIDERS["muse-spark-web"].baseUrl as string;
const META_AI_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
// Persisted-query ids for Meta's current GraphQL send-message subscription.
// The previous "Abra" mutation (RewriteOptionsInput) was retired when Meta
// removed that input type from the schema — these are the live doc_ids.
const META_AI_WARMUP_DOC_ID = "e7f802582dbfed8e181b012e010993eb";
const META_AI_MODE_SWITCH_DOC_ID = "c32bbe999c48e64e855dc63177d5153f";
const META_AI_DEFAULT_COOKIE = "ecto_1_sess";

type MuseSparkModelInfo = { mode: string; isThinking: boolean };

const MODEL_MAP: Record<string, MuseSparkModelInfo> = {
  "muse-spark-1.2": { mode: "think_fast", isThinking: false },
  "muse-spark": { mode: "think_fast", isThinking: false },
  "muse-spark-thinking": { mode: "think_hard", isThinking: true },
  "muse-spark-contemplating": { mode: "think_hard", isThinking: true },
};

function getModelInfo(model: string): MuseSparkModelInfo {
  return MODEL_MAP[model] || MODEL_MAP["muse-spark-1.2"];
}

// ─── Message flattening ─────────────────────────────────────────────────────

type NormalizedMessage = { role: string; content: string };

type ParsedHistory = {
  foldedPrompt: string;
  latestUserContent: string;
  lastAssistantIndex: number;
  normalized: NormalizedMessage[];
};

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part: Record<string, unknown>) => (part && (part.type === "text" || part.type === "input_text") && typeof part.text === "string" ? part.text : ""))
    .filter((part: string) => part.trim().length > 0)
    .join("\n")
    .trim();
}

function parseOpenAIMessages(messages: Array<Record<string, unknown>>): ParsedHistory {
  const extracted: NormalizedMessage[] = [];
  for (const message of messages) {
    let role = String(message.role || "user");
    if (role === "developer") role = "system";
    const content = extractMessageText(message.content);
    if (!content) continue;
    extracted.push({ role, content });
  }

  if (extracted.length === 0) {
    return { foldedPrompt: "", latestUserContent: "", lastAssistantIndex: -1, normalized: [] };
  }

  let lastUserIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") { lastUserIndex = i; break; }
  }
  let lastAssistantIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "assistant") { lastAssistantIndex = i; break; }
  }

  const foldedPrompt = extracted
    .map((message, index) => (index === lastUserIndex ? message.content : `${message.role}: ${message.content}`))
    .join("\n\n")
    .trim();

  const latestUserContent = lastUserIndex >= 0 ? extracted[lastUserIndex].content : "";
  return { foldedPrompt, latestUserContent, lastAssistantIndex, normalized: extracted };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

// ─── Conversation continuity cache ──────────────────────────────────────────
// /v1/chat/completions is stateless (full history resent every turn). Without
// this, every turn opens a brand-new meta.ai conversation containing the
// whole OpenAI history folded into one prompt. Caching the conversationId we
// created last turn — keyed by a hash of (connectionId, model, history prefix
// through the last assistant turn) — lets a real continuation reuse the same
// meta.ai conversation and send only the latest user turn.

type CachedConversation = { conversationId: string; branchPath: string; expiresAt: number };

const MUSE_CONV_CACHE_MAX = 5000;
const MUSE_CONV_CACHE_TTL_MS = 30 * 60 * 1000;
const conversationCache = new Map<string, CachedConversation>();

function canonicalizeHistory(messages: NormalizedMessage[]): string {
  return messages.map((m) => `${m.role}\x1e${m.content}`).join("\x1f");
}

function makeCacheKey(connectionId: string, model: string, normalizedPrefix: NormalizedMessage[]): string {
  return createHash("sha256").update(`${connectionId}\x1f${model}\x1f${canonicalizeHistory(normalizedPrefix)}`).digest("hex");
}

function lookupCachedConversation(key: string): CachedConversation | null {
  const entry = conversationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    conversationCache.delete(key);
    return null;
  }
  return entry;
}

function rememberConversation(key: string, context: { conversationId: string; branchPath: string }): void {
  if (conversationCache.size >= MUSE_CONV_CACHE_MAX && !conversationCache.has(key)) {
    const oldest = conversationCache.keys().next().value;
    if (oldest) conversationCache.delete(oldest);
  }
  conversationCache.set(key, { conversationId: context.conversationId, branchPath: context.branchPath, expiresAt: Date.now() + MUSE_CONV_CACHE_TTL_MS });
}

type ConversationContext = { conversationId: string; branchPath: string; isNewConversation: boolean };

function getConversationContext(cached: CachedConversation | null): ConversationContext {
  if (!cached) return { conversationId: generateMetaConversationId(), branchPath: META_AI_ROOT_BRANCH_PATH, isNewConversation: true };
  return { conversationId: cached.conversationId, branchPath: cached.branchPath, isNewConversation: false };
}

// ─── Auth / headers ──────────────────────────────────────────────────────────

/** Accepts either a full "name=value; name2=value2" cookie header or a bare
 * session value, which gets wrapped as `ecto_1_sess=<value>`. */
function normalizeCookieHeader(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.includes("=") ? trimmed : `${META_AI_DEFAULT_COOKIE}=${trimmed}`;
}

function buildMetaAiHeaders(cookieHeader: string): Record<string, string> {
  return {
    Accept: "text/event-stream",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    Origin: "https://www.meta.ai",
    Referer: "https://www.meta.ai/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": META_AI_USER_AGENT,
    "X-ASBD-ID": "129477",
    "X-FB-Friendly-Name": "useEctoSendMessageSubscription",
    "X-FB-Request-Analytics-Tags": "graphservice",
  };
}

async function graphqlPost(docId: string, variables: Record<string, unknown>, cookieHeader: string, label: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(META_AI_GRAPHQL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "multipart/mixed, application/json",
        Cookie: cookieHeader,
        "User-Agent": META_AI_USER_AGENT,
        Origin: "https://www.meta.ai",
      },
      body: JSON.stringify({ doc_id: docId, variables }),
      signal,
    });
    if (!response.ok) return { ok: false, error: `${label} failed: HTTP ${response.status}` };
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        return { ok: false, error: `${label} failed: ${json.errors[0]?.message || "Unknown GraphQL error"}` };
      }
    } catch { /* not JSON or no errors — treat as success */ }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${label} fetch failed: ${msg}` };
  }
}

// ─── Response building ──────────────────────────────────────────────────────

function buildStreamingResponse(deltas: string[], model: string, cid: string, created: number) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
      })));
      for (const delta of deltas) {
        if (!delta) continue;
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null, logprobs: null }],
        })));
      }
      controller.enqueue(encoder.encode(sseChunk({
        id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
        choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
      })));
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  });
}

function buildNonStreamingResponse(content: string, model: string, cid: string, created: number) {
  const tokens = estimateTokens(content);
  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: tokens, completion_tokens: tokens, total_tokens: tokens * 2 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function errorResponse(status: number, message: string, code: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code } }), { status, headers: { "Content-Type": "application/json" } });
}

export class MuseSparkWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-spark-web", PROVIDERS["muse-spark-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array", "invalid_request"), url: META_AI_GRAPHQL_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const parsedHistory = parseOpenAIMessages(messages);
    if (!parsedHistory.foldedPrompt) {
      return { response: errorResponse(400, "Empty query after processing messages", "invalid_request"), url: META_AI_GRAPHQL_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    // The WS auth token (ecto1:...) must come from the user's own DevTools
    // session (Network → WS → clippy request → Authorization param) — it is
    // not derivable from the cookie alone. Accept it either as a dedicated
    // providerSpecificData field or embedded in the apiKey paste.
    let authorization = "";
    if (typeof credentials.providerSpecificData?.authorization === "string" && credentials.providerSpecificData.authorization) {
      authorization = credentials.providerSpecificData.authorization.trim();
    } else if (typeof credentials.apiKey === "string") {
      const match = credentials.apiKey.match(/ecto1:\S+/i);
      authorization = match ? match[0].trim() : "";
    }
    if (!authorization) {
      const resp = errorResponse(400, "Missing Authorization for Meta AI WebSocket — paste the ecto1:... WS auth token from meta.ai DevTools (Network → WS → clippy request Authorization param), alongside your ecto_1_sess cookie.", "missing_authorization");
      return { response: resp, url: META_AI_GRAPHQL_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const cookieHeader = normalizeCookieHeader(credentials.apiKey || "");
    if (!cookieHeader) {
      const resp = errorResponse(400, "Missing ecto_1_sess cookie for Meta AI", "missing_credentials");
      return { response: resp, url: META_AI_GRAPHQL_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const connectionId = credentials.connectionId;
    const cacheKey = connectionId && parsedHistory.lastAssistantIndex >= 0 && parsedHistory.latestUserContent
      ? makeCacheKey(connectionId, model, parsedHistory.normalized.slice(0, parsedHistory.lastAssistantIndex + 1))
      : null;
    const cached = cacheKey ? lookupCachedConversation(cacheKey) : null;
    const conversationContext = getConversationContext(cached);

    const prompt = cached ? parsedHistory.latestUserContent : parsedHistory.foldedPrompt;
    const modelInfo = getModelInfo(model);
    const templateB64 = cached ? META_WS_CHAT_TEMPLATE_B64 : META_WS_HOME_TEMPLATE_B64;
    const headers = buildMetaAiHeaders(cookieHeader);

    log?.info?.("MUSE-SPARK-WEB", `Query to ${model}, len=${prompt.length}, newConv=${conversationContext.isNewConversation}`);

    const warmupResult = await graphqlPost(META_AI_WARMUP_DOC_ID, { conversationId: conversationContext.conversationId }, cookieHeader, "Warmup", signal);
    if (!warmupResult.ok) {
      if (cached && cacheKey) conversationCache.delete(cacheKey);
      log?.error?.("MUSE-SPARK-WEB", warmupResult.error);
      return { response: errorResponse(502, warmupResult.error, "meta_ai_warmup_failed"), url: META_AI_GRAPHQL_API, headers, transformedBody: body };
    }

    const modeResult = await graphqlPost(META_AI_MODE_SWITCH_DOC_ID, { input: { conversationId: conversationContext.conversationId, mode: modelInfo.mode } }, cookieHeader, "Mode switch", signal);
    if (!modeResult.ok) {
      if (cached && cacheKey) conversationCache.delete(cacheKey);
      log?.error?.("MUSE-SPARK-WEB", modeResult.error);
      return { response: errorResponse(502, modeResult.error, "meta_ai_mode_switch_failed"), url: META_AI_GRAPHQL_API, headers, transformedBody: body };
    }

    const wsResult = await wsChat(prompt, conversationContext.conversationId, authorization, cookieHeader, templateB64, signal);

    if (wsResult.error) {
      if (cached && cacheKey) conversationCache.delete(cacheKey);
      log?.error?.("MUSE-SPARK-WEB", `WS error: ${wsResult.error}`);
      const lower = wsResult.error.toLowerCase();
      const status = /auth|authorization|401/.test(lower) ? 401 : 502;
      const message = status === 401
        ? `${wsResult.error} — your meta.ai ecto_1_sess cookie may be missing or expired; re-paste it from DevTools.`
        : wsResult.error;
      return { response: errorResponse(status, message, "meta_ai_ws_error"), url: META_AI_GRAPHQL_API, headers, transformedBody: body };
    }

    const content = wsResult.content || "";
    if (!content && !wsResult.deltas.length) {
      if (cached && cacheKey) conversationCache.delete(cacheKey);
      log?.error?.("MUSE-SPARK-WEB", "WS returned empty response");
      return { response: errorResponse(502, "Meta AI returned no assistant content", "meta_ai_empty_response"), url: META_AI_GRAPHQL_API, headers, transformedBody: body };
    }

    if (connectionId && content) {
      const writePrefix: NormalizedMessage[] = [...parsedHistory.normalized, { role: "assistant", content }];
      rememberConversation(makeCacheKey(connectionId, model, writePrefix), { conversationId: conversationContext.conversationId, branchPath: conversationContext.branchPath });
    }

    const deltas = wsResult.deltas.length > 0 ? wsResult.deltas : [content];
    const cid = `chatcmpl-meta-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    const finalResponse = stream
      ? new Response(buildStreamingResponse(deltas, model, cid, created), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } })
      : buildNonStreamingResponse(content, model, cid, created);

    return { response: finalResponse, url: META_AI_GRAPHQL_API, headers, transformedBody: body };
  }
}

export default MuseSparkWebExecutor;
