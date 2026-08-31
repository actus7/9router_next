import { createHash, randomUUID } from "node:crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";
import {
  HYPERAGENT_FALLBACK_MODELS,
  clientFacingHyperAgentModelId,
  wireHyperAgentModelId,
  wireHyperAgentRuntimeId,
  wireHyperAgentSubagentModelId,
} from "./hyperagent/models";

// HyperAgent is a stateful thread+session agent chat, not a single-call
// OpenAI pass-through (our previous executor's assumption): create a thread,
// PATCH its model/runtime, POST a chat turn, and parse a custom SSE event
// stream ({type:"text"|"session_start"|"thread_runtime_latched"|"error"}).
// OpenAI's stateless multi-turn is bridged onto HyperAgent's stateful thread
// via a sticky fingerprint cache (in-memory only — no disk persistence, same
// as every other session cache in this codebase).
export { HYPERAGENT_FALLBACK_MODELS };

const ORIGIN = "https://hyperagent.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const THREAD_CACHE_MAX = 200;

interface ChatMessage {
  role: string;
  content: unknown;
}
type ThreadBinding = { threadId: string; sessionId: string; projectKey: string; updatedAt: number };

const threadBindings = new Map<string, ThreadBinding>();

function readStr(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length ? t : "";
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      const type = typeof p.type === "string" ? p.type.toLowerCase() : "";
      if (type === "tool_result" || type === "function_result") {
        const name = typeof p.name === "string" ? p.name : "tool";
        const body = extractMessageText(p.content ?? p.output ?? p.result ?? "");
        return body ? `[tool result ${name}]\n${body}` : `[tool result ${name}]`;
      }
      if (type === "tool_use" || type === "function_call" || type === "tool_call") {
        const name = typeof p.name === "string" ? p.name : "tool";
        let args = "";
        if (p.input != null) {
          try { args = typeof p.input === "string" ? p.input : JSON.stringify(p.input); } catch { args = String(p.input); }
        } else if (typeof p.arguments === "string") {
          args = p.arguments;
        }
        return args ? `[tool call ${name}] ${args}` : `[tool call ${name}]`;
      }
      if (typeof p.text === "string") return p.text;
      if (typeof p.content === "string") return p.content;
      if (p.content != null && typeof p.content !== "string") return extractMessageText(p.content);
      return "";
    }).filter(Boolean).join("\n");
  }
  if (content && typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
  }
  return "";
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = (messages[i]?.role || "").toLowerCase();
    if (role === "user" || role === "human" || role === "tool" || role === "function") {
      return extractMessageText(messages[i]!.content).trim();
    }
  }
  return "";
}

// ── Sticky thread cache (in-memory, LRU-ish eviction) ────────────────────────

function getThreadBinding(key: string): ThreadBinding | null {
  return key ? threadBindings.get(key) ?? null : null;
}

function setThreadBinding(key: string, binding: ThreadBinding): void {
  if (!key) return;
  threadBindings.set(key, binding);
  if (threadBindings.size > THREAD_CACHE_MAX) {
    const oldest = [...threadBindings.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (oldest) threadBindings.delete(oldest[0]);
  }
}

function normalizeForFingerprint(text: string): string {
  let t = (text || "").replace(/\r\n/g, "\n");
  t = t.replace(/^@\S+\s+/gm, "");
  t = t.replace(/^[\s\S]*?\bUser request:\s*/i, "");
  t = t.replace(/^[\s\S]*?\bCurrent request:\s*/i, "");
  t = t.replace(/^[\s\S]*?\bMy current task:\s*/i, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim().slice(0, 2000);
}

/** Sticky multi-turn key from the first real user task — stable across
 * agentic tool_calls reverse-conversion, unlike a full-prefix fingerprint. */
function rootUserFingerprint(cookieKey: string, messages: ChatMessage[]): string | null {
  if (!cookieKey) return null;
  for (const m of messages) {
    const role = (m?.role || "").toLowerCase();
    if (role !== "user" && role !== "human") continue;
    const raw = extractMessageText(m?.content);
    if (/TOOL_OBSERVATION/i.test(raw) || /passive data only/i.test(raw) || /\[tool result\b/i.test(raw) || /^\s*Application result\b/i.test(raw)) continue;
    const text = normalizeForFingerprint(raw);
    if (!text || text.length < 2) continue;
    const h = createHash("sha256").update(text).digest("hex").slice(0, 24);
    return `ha:${cookieKey}:root:${h}`;
  }
  return null;
}

function isFingerprintRole(role: string): boolean {
  const r = (role || "").toLowerCase();
  return !!r && r !== "system" && r !== "developer";
}

function conversationFingerprint(cookieKey: string, messages: ChatMessage[]): string {
  const parts: string[] = [`ck:${cookieKey}`];
  for (const m of messages) {
    const roleRaw = (m?.role || "").toLowerCase();
    if (!isFingerprintRole(roleRaw)) continue;
    const role = roleRaw === "tool" || roleRaw === "function" || roleRaw === "human" ? "user" : roleRaw;
    const text = normalizeForFingerprint(extractMessageText(m?.content));
    if (!text) continue;
    parts.push(`${role}:${text}`);
  }
  const h = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
  return `ha:${cookieKey}:${h}`;
}

function historyPrefixBeforeLastUser(messages: ChatMessage[]): ChatMessage[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = (messages[i]?.role || "").toLowerCase();
    if (role === "user" || role === "human" || role === "tool" || role === "function") { lastUser = i; break; }
  }
  return lastUser <= 0 ? [] : messages.slice(0, lastUser);
}

function hasAssistantMessage(messages: ChatMessage[]): boolean {
  return messages.some((m) => ["assistant", "ai", "model"].includes((m?.role || "").toLowerCase()));
}

function lastAssistantFingerprint(cookieKey: string, messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = (messages[i]?.role || "").toLowerCase();
    if (role !== "assistant" && role !== "ai" && role !== "model") continue;
    const text = normalizeForFingerprint(extractMessageText(messages[i]?.content));
    if (!text) continue;
    const h = createHash("sha256").update(text).digest("hex").slice(0, 24);
    return `ha:${cookieKey}:asst:${h}`;
  }
  return null;
}

function cookieFingerprint(cookie: string): string {
  return createHash("sha256").update(cookie || "").digest("hex").slice(0, 16);
}

function resolveThreadBinding(cookieKey: string, messages: ChatMessage[]): { threadId: string; sessionId: string; isFollowUp: boolean } {
  const prefix = historyPrefixBeforeLastUser(messages);
  const prefixKey = prefix.length > 0 && hasAssistantMessage(prefix) ? conversationFingerprint(cookieKey, prefix) : null;
  const rootKey = rootUserFingerprint(cookieKey, messages);

  if (prefixKey) {
    const cached = getThreadBinding(prefixKey);
    if (cached?.threadId && cached.projectKey === cookieKey) return { threadId: cached.threadId, sessionId: cached.sessionId, isFollowUp: true };
  }
  if (rootKey && hasAssistantMessage(messages)) {
    const cached = getThreadBinding(rootKey);
    if (cached?.threadId && cached.projectKey === cookieKey) return { threadId: cached.threadId, sessionId: cached.sessionId, isFollowUp: true };
  }
  if (hasAssistantMessage(messages)) {
    const asstKey = lastAssistantFingerprint(cookieKey, prefix.length ? prefix : messages);
    if (asstKey) {
      const cached = getThreadBinding(asstKey);
      if (cached?.threadId && cached.projectKey === cookieKey) return { threadId: cached.threadId, sessionId: cached.sessionId, isFollowUp: true };
    }
  }
  return { threadId: "", sessionId: "", isFollowUp: false };
}

function storeThreadAfterTurn(cookieKey: string, messages: ChatMessage[], assistantText: string, threadId: string, sessionId: string): void {
  if (!cookieKey || !threadId) return;
  const full: ChatMessage[] = [...messages, { role: "assistant", content: assistantText || "" }];
  if (!hasAssistantMessage(full) || !messages.some((m) => ["user", "human", "tool", "function"].includes((m.role || "").toLowerCase()))) return;

  const binding: ThreadBinding = { threadId, sessionId: sessionId || "", projectKey: cookieKey, updatedAt: Date.now() };
  setThreadBinding(conversationFingerprint(cookieKey, full), binding);
  const prefix = historyPrefixBeforeLastUser(messages);
  if (prefix.length > 0 && hasAssistantMessage(prefix)) setThreadBinding(conversationFingerprint(cookieKey, prefix), binding);
  const asstKey = lastAssistantFingerprint(cookieKey, full);
  if (asstKey) setThreadBinding(asstKey, binding);
  const rootKey = rootUserFingerprint(cookieKey, messages);
  if (rootKey) setThreadBinding(rootKey, binding);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function browserHeaders(cookie: string, extra?: Record<string, string>): Record<string, string> {
  return { accept: "*/*", "accept-language": "en-US,en;q=0.9", cookie, origin: ORIGIN, referer: `${ORIGIN}/`, "user-agent": USER_AGENT, ...extra };
}

function extractThreadIdFromUrl(url: string): string {
  if (!url) return "";
  const m = url.match(/\/thread\/([A-Za-z0-9_-]{10,})/i) || url.match(/(cm[a-z0-9]{20,})/i);
  return m ? m[1]! : "";
}

async function createThread(cookie: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`${ORIGIN}/api/threads`, {
      method: "POST",
      headers: browserHeaders(cookie, { "content-type": "application/json", "x-request-id": randomUUID() }),
      body: JSON.stringify({}),
      signal,
      redirect: "manual",
    });
    const loc = res.headers.get("location") || res.headers.get("Location") || "";
    const fromLoc = extractThreadIdFromUrl(loc);
    if (fromLoc) return fromLoc;
    if (res.ok) {
      const text = await res.text();
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        const id = readStr(j.id) || readStr(j.threadId) || readStr(j.thread_id) || (j.thread && typeof j.thread === "object" ? readStr((j.thread as Record<string, unknown>).id) : "");
        if (id) return id;
      } catch {
        const m = text.match(/cm[a-z0-9]{20,}/i);
        if (m) return m[0]!;
      }
    }
  } catch { /* fall through to the RSC fallback */ }

  const res2 = await fetch(`${ORIGIN}/threads/new`, {
    method: "GET",
    headers: browserHeaders(cookie, { rsc: "1", "next-url": "/", "x-request-id": randomUUID() }),
    signal,
    redirect: "manual",
  });
  const loc2 = res2.headers.get("location") || res2.headers.get("Location") || res2.headers.get("x-middleware-rewrite") || "";
  const fromLoc2 = extractThreadIdFromUrl(loc2);
  if (fromLoc2) return fromLoc2;
  if (res2.status >= 200 && res2.status < 400) {
    const text = await res2.text().catch(() => "");
    const m = text.match(/\/thread\/(cm[a-z0-9]{20,})/i) || text.match(/"(cm[a-z0-9]{20,})"/i);
    if (m) return m[1]!;
  }
  throw new Error(`Could not create HyperAgent thread (HTTP ${res2.status}). Ensure the session Cookie is valid and not expired.`);
}

async function configureThread(cookie: string, threadId: string, opts: { modelId: string; subagentModelId: string; runtimeId: string }, signal?: AbortSignal): Promise<void> {
  const body: Record<string, unknown> = { modelId: opts.modelId, defaultSubagentModel: opts.subagentModelId, runtimeId: opts.runtimeId, executionMode: "auto" };
  const res = await fetch(`${ORIGIN}/api/threads/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    headers: browserHeaders(cookie, { "content-type": "application/json", "x-request-id": randomUUID(), referer: `${ORIGIN}/thread/${threadId}` }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HyperAgent configure thread HTTP ${res.status}: ${errText.slice(0, 300) || res.statusText}`);
  }
}

/** Feature-flag defaults from a live SPA execution-mode capture. modelId is
 * deliberately absent — the model is PATCHed onto the thread, not sent here. */
function buildChatBody(content: string, sessionId: string | null): Record<string, unknown> {
  return {
    sessionId, unifiedStream: true, searchMode: "exa", enableExecuteScript: false, enablePersistentSandbox: true,
    enableWebpage: true, enableSlides: true, tablesEnabled: true, enableWebSearch: true, enableBrowser: true,
    enableImageGeneration: true, enableVideoGeneration: true, enableAudioGeneration: true, enableTranscription: true,
    enableAvatarVideo: true, enableExaFindSimilar: true, enableExaAnswer: true, enableExaResearch: true, enableExaWebsets: true,
    enableGeoTools: true, hyperAppsEnabled: false, documentsEnabled: true, enableThreadSearch: true,
    residentialProxyEnabled: false, solveCaptchasEnabled: true, content, debug: false,
    enabledIntegrations: [], integrationMode: "open", globalTablesEnabled: true,
  };
}

async function parseSseStream(response: Response): Promise<{ text: string; sessionId: string; modelId: string; events: number }> {
  if (!response.body) throw new Error("Empty HyperAgent stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let sessionId = "";
  let modelId = "";
  let events = 0;

  const handleData = (payload: string) => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(trimmed) as Record<string, unknown>; } catch { return; }
    events += 1;
    const type = readStr(obj.type);
    if (type === "text") {
      text += typeof obj.content === "string" ? obj.content : "";
    } else if (type === "session_start") {
      const sid = readStr(obj.sessionId);
      if (sid) sessionId = sid;
    } else if (type === "thread_runtime_latched") {
      const mid = readStr(obj.modelId);
      if (mid) modelId = mid;
    } else if (type === "error" || type === "stream_error") {
      throw new Error(readStr(obj.content) || readStr(obj.message) || readStr(obj.error) || "HyperAgent stream error");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const t = line.trimEnd();
      if (t.startsWith("data:")) handleData(t.slice(5).trimStart());
    }
  }
  if (buffer.trim().startsWith("data:")) handleData(buffer.trim().slice(5).trimStart());
  return { text, sessionId, modelId, events };
}

function estimateUsage(messages: ChatMessage[], content: string) {
  const prompt = messages.map((m) => extractMessageText(m.content)).join("\n");
  const prompt_tokens = Math.max(1, Math.ceil(prompt.length / 4));
  const completion_tokens = Math.max(1, Math.ceil(content.length / 4));
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
}

function chatCompletionResponse(content: string, model: string, messages: ChatMessage[], threadId: string, sessionId: string): Response {
  const id = `chatcmpl-ha-${threadId}`;
  return new Response(JSON.stringify({
    id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: estimateUsage(messages, content),
  }), { status: 200, headers: { "Content-Type": "application/json", "X-HyperAgent-Thread-Id": threadId, ...(sessionId ? { "X-HyperAgent-Session-Id": sessionId } : {}) } });
}

/** HyperAgent has no native token-level stream — chunk the finished text so
 * clients still see incremental delivery. */
function pseudoStreamResponse(content: string, model: string, threadId: string, sessionId: string): Response {
  const encoder = new TextEncoder();
  const id = `chatcmpl-ha-${threadId}`;
  const chunk = (delta: string, finishReason: string | null) => ({
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: delta ? { content: delta } : {}, finish_reason: finishReason }],
  });
  const readable = new ReadableStream({
    start(controller) {
      const parts = content.match(/\S+\s*/g) || [content];
      let buf = "";
      for (const p of parts) {
        buf += p;
        if (buf.length >= 40) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(buf, null))}\n\n`)); buf = ""; }
      }
      if (buf) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(buf, null))}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk("", "stop"))}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(readable, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-HyperAgent-Thread-Id": threadId, ...(sessionId ? { "X-HyperAgent-Session-Id": sessionId } : {}) } });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
}

export class HyperAgentExecutor extends BaseExecutor {
  constructor() {
    super("hyperagent", PROVIDERS["hyperagent"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const cookie = (credentials.apiKey || "").trim().replace(/^Cookie:\s*/i, "");
    if (!cookie) {
      return { response: errorResponse(401, "Missing HyperAgent session cookie — paste the full Cookie header from hyperagent.com (DevTools → Network → any document request → Request Headers → Cookie)"), url: `${ORIGIN}/api/threads`, headers: {} as Record<string, string>, transformedBody: body };
    }

    const messages = (Array.isArray(body?.messages) ? body.messages : []) as ChatMessage[];
    const userText = lastUserText(messages);
    if (!userText) {
      return { response: errorResponse(400, "No user message found"), url: `${ORIGIN}/api/threads`, headers: {} as Record<string, string>, transformedBody: body };
    }

    const requestedModel = model || (body.model as string);
    const clientFacing = clientFacingHyperAgentModelId(requestedModel);
    const wireModel = wireHyperAgentModelId(requestedModel);
    const subagentModel = wireHyperAgentSubagentModelId(requestedModel);
    const runtimeId = wireHyperAgentRuntimeId(requestedModel);
    const cookieKey = cookieFingerprint(cookie);

    const binding = resolveThreadBinding(cookieKey, messages);
    let threadId = binding.threadId;
    let sessionId: string | null = binding.sessionId || null;

    const finalize = (parsed: { text: string; sessionId: string; modelId: string; events: number }) => {
      const text = (parsed.text || "").trim();
      if (!text) {
        return { response: errorResponse(502, `HyperAgent returned empty content (events=${parsed.events})`), url: `${ORIGIN}/api/threads`, headers: {} as Record<string, string>, transformedBody: body };
      }
      storeThreadAfterTurn(cookieKey, messages, text, threadId, parsed.sessionId || "");
      const modelOut = parsed.modelId || clientFacing;
      const response = stream ? pseudoStreamResponse(text, modelOut, threadId, parsed.sessionId) : chatCompletionResponse(text, modelOut, messages, threadId, parsed.sessionId);
      return { response, url: `${ORIGIN}/api/threads/${threadId}/chat`, headers: { Cookie: "***" }, transformedBody: { threadId, sessionId: parsed.sessionId || null, model: modelOut } };
    };

    log?.info?.("HYPERAGENT", `Query to ${wireModel}, followUp=${binding.isFollowUp}`);

    try {
      if (!binding.isFollowUp || !threadId) {
        threadId = await createThread(cookie, signal);
        sessionId = null;
      }

      await configureThread(cookie, threadId, { modelId: wireModel, subagentModelId: subagentModel, runtimeId }, signal);

      const chatUrl = `${ORIGIN}/api/threads/${encodeURIComponent(threadId)}/chat`;
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: browserHeaders(cookie, { "content-type": "application/json", referer: `${ORIGIN}/thread/${threadId}`, "x-request-id": randomUUID() }),
        body: JSON.stringify(buildChatBody(userText, sessionId)),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        // Stale thread → create once, reconfigure, retry.
        if (res.status === 404 || /not found|unknown thread/i.test(errText)) {
          threadId = await createThread(cookie, signal);
          sessionId = null;
          await configureThread(cookie, threadId, { modelId: wireModel, subagentModelId: subagentModel, runtimeId }, signal);
          const retryUrl = `${ORIGIN}/api/threads/${encodeURIComponent(threadId)}/chat`;
          const res2 = await fetch(retryUrl, {
            method: "POST",
            headers: browserHeaders(cookie, { "content-type": "application/json", referer: `${ORIGIN}/thread/${threadId}`, "x-request-id": randomUUID() }),
            body: JSON.stringify(buildChatBody(userText, null)),
            signal,
          });
          if (!res2.ok) {
            const t2 = await res2.text().catch(() => "");
            return { response: errorResponse(res2.status >= 400 && res2.status < 600 ? res2.status : 502, `HyperAgent chat HTTP ${res2.status}: ${t2.slice(0, 300)}`), url: retryUrl, headers: {} as Record<string, string>, transformedBody: body };
          }
          return finalize(await parseSseStream(res2));
        }
        return { response: errorResponse(res.status >= 400 && res.status < 600 ? res.status : 502, `HyperAgent chat HTTP ${res.status}: ${errText.slice(0, 300)}`), url: chatUrl, headers: {} as Record<string, string>, transformedBody: body };
      }

      const parsed = await parseSseStream(res);
      if (!parsed.sessionId && sessionId) parsed.sessionId = sessionId;
      return finalize(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /cookie|401|unauthor/i.test(msg) ? 401 : /timeout/i.test(msg) ? 504 : 502;
      return { response: errorResponse(status, `HyperAgent: ${msg}`), url: `${ORIGIN}/api/threads`, headers: {} as Record<string, string>, transformedBody: body };
    }
  }
}

export default HyperAgentExecutor;
