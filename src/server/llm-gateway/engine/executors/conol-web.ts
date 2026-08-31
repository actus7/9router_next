import { createHash } from "node:crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";
import { resolveConolModelSelection, type ConolEffort } from "./conol-web/models";
import { applyConolSessionModel, buildConolSessionModelPlan } from "./conol-web/sessionModel";

// Conol is a session-based agent chat, not a single-call OpenAI pass-through
// (our previous executor's assumption): a session must be created, its model
// pinned via 3 sequential calls (preset → model → effort — order load-bearing,
// the model call resets effort to null), a turn posted, then the answer read
// back via a separate NDJSON polling GET. Image attachments are dropped here
// (out of scope for this campaign — no other webCookie provider in this
// codebase supports them either).
const CONOL_ORIGIN = "https://conol.ai";
const CONOL_SESSION_URL = PROVIDERS["conol-web"].baseUrl as string;
const CONOL_SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";
const CONOL_REQUEST_TIMEOUT_MS = 300_000;
const CONOL_MAX_STREAM_BYTES = 16 * 1024 * 1024;
const CONOL_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const CONOL_MAX_SESSION_BINDINGS = 500;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

interface ChatMessage {
  role: string;
  content: unknown;
}

interface ConolSessionBinding {
  upstreamSessionId: string;
  lastUsedAt: number;
  presetApplied: boolean;
  appliedModel: string;
  appliedEffort: ConolEffort | null;
}

interface ParsedConolStream {
  text: string;
  done: boolean;
}

const conolSessionBindings = new Map<string, ConolSessionBinding>();
const conolSessionLocks = new Map<string, Promise<void>>();

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => extractText(item)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const type = readString(record.type).toLowerCase();
  if (type === "image_url" || type === "input_image" || type === "image") return "";
  return readString(record.text) || (typeof record.content === "string" ? record.content : extractText(record.content)) || extractText(record.output) || extractText(record.result);
}

function extractUserText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => extractUserText(item)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const type = readString(record.type).toLowerCase();
  if (type === "text" || type === "input_text" || type === "output_text") return readString(record.text) || readString(record.content);
  if (type) return ""; // Don't flatten tool calls/results/images into the prompt.
  return readString(record.text) || extractUserText(record.content);
}

function stripGeneratedImageMarkers(value: string): string {
  return value
    .replace(/^\s*\[Image\s+\d+\]:\s*\(unavailable\)\s*$/gim, "")
    .replace(/^\s*\[Image:\s*source:\s*[^\]\r\n]+\]\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildConolPrompt(messages: ChatMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((m) => readString(m.role).toLowerCase() === "user");
  if (!latestUserMessage) return "";
  return stripGeneratedImageMarkers(extractUserText(latestUserMessage.content));
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Resolve a stable client-session key from request metadata, so follow-up
 * turns reuse the same Conol session instead of starting a fresh one. */
function resolveConolClientSessionKey(body: Record<string, unknown>): string | null {
  const metadata = body.metadata;
  const metaSessionId = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? readString((metadata as Record<string, unknown>).session_id) || readString((metadata as Record<string, unknown>).sessionId)
    : "";
  const candidates = [
    metaSessionId,
    readString(body.conversation_id),
    readString(body.conversationId),
    readString(body.session_id),
    readString(body.sessionId),
    readString(body.prompt_cache_key),
    readString(body.promptCacheKey),
  ];
  const candidate = candidates.find((value) => value.length > 0 && value.length <= 4096);
  return candidate ? hashKey(candidate) : null;
}

function sweepConolSessionBindings(now = Date.now()): void {
  for (const [key, binding] of conolSessionBindings) {
    if (now - binding.lastUsedAt > CONOL_SESSION_TTL_MS) conolSessionBindings.delete(key);
  }
  while (conolSessionBindings.size > CONOL_MAX_SESSION_BINDINGS) {
    let oldestKey = "";
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, binding] of conolSessionBindings) {
      if (binding.lastUsedAt < oldestTime) { oldestKey = key; oldestTime = binding.lastUsedAt; }
    }
    if (!oldestKey) break;
    conolSessionBindings.delete(oldestKey);
  }
}

function getConolSessionBinding(key: string): ConolSessionBinding | null {
  sweepConolSessionBindings();
  const binding = conolSessionBindings.get(key);
  if (!binding) return null;
  binding.lastUsedAt = Date.now();
  return binding;
}

function setConolSessionBinding(key: string, binding: Omit<ConolSessionBinding, "lastUsedAt">): void {
  conolSessionBindings.set(key, { ...binding, lastUsedAt: Date.now() });
  sweepConolSessionBindings();
}

/** Serializes turns for the same client session so concurrent requests don't
 * race on session creation/model pinning. */
async function withConolSessionLock<T>(key: string | null, operation: () => Promise<T>): Promise<T> {
  if (!key) return operation();
  const previous = conolSessionLocks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const currentGate = new Promise<void>((resolve) => { releaseCurrent = resolve; });
  const current = previous.catch(() => undefined).then(() => currentGate);
  conolSessionLocks.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (conolSessionLocks.get(key) === current) conolSessionLocks.delete(key);
  }
}

function stageAssistantText(stages: unknown, field: "logs" | "preview"): string {
  if (!Array.isArray(stages)) return "";
  let result = "";
  for (const stage of stages) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) continue;
    const entries = (stage as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const message = entry as Record<string, unknown>;
      if (readString(message.role).toLowerCase() !== "assistant") continue;
      const text = extractText(message.content).trim();
      if (text) result = text;
    }
  }
  return result;
}

function parseEventLine(originalLine: string): unknown | null {
  let line = originalLine.trim();
  if (!line || line.startsWith(":") || line.startsWith("event:")) return null;
  if (line.startsWith("data:")) line = line.slice(5).trim();
  if (line.startsWith("message\t")) line = line.slice("message\t".length);
  if (!line) return null;
  if (line === "[DONE]") return { type: "done" };
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isDoneEvent(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && readString((value as Record<string, unknown>).type) === "done";
}

function parseEventLines(raw: string): unknown[] {
  const events: unknown[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const event = parseEventLine(line);
    if (event) events.push(event);
  }
  return events;
}

/** Conol emits a terminal `done` event but keeps the HTTP stream open —
 * consume complete lines and cancel the reader as soon as `done` arrives
 * instead of waiting for the request timeout. */
async function collectConolMessageStream(response: Response): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let pending = "";
  let totalBytes = 0;
  let doneEventReceived = false;

  try {
    while (!doneEventReceived) {
      const chunk = await reader.read();
      if (chunk.done) { pending += decoder.decode(); break; }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > CONOL_MAX_STREAM_BYTES) throw new Error("Conol message stream exceeded the safety limit");
      pending += decoder.decode(chunk.value, { stream: true });
      const completeLines = pending.split(/\r?\n/);
      pending = completeLines.pop() ?? "";
      for (const line of completeLines) {
        lines.push(line);
        if (isDoneEvent(parseEventLine(line))) { doneEventReceived = true; break; }
      }
    }
    if (!doneEventReceived && pending) lines.push(pending);
  } finally {
    if (doneEventReceived) {
      try { await reader.cancel(); } catch { /* upstream may close at the same instant */ }
    } else {
      reader.releaseLock();
    }
  }
  return lines.join("\n");
}

function parseConolMessageStream(raw: string): ParsedConolStream {
  let finalizedText = "";
  let previewText = "";
  let streamedText = "";
  let done = false;

  for (const value of parseEventLines(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const event = value as Record<string, unknown>;
    const type = readString(event.type);
    if (type === "done") { done = true; continue; }

    const finalCandidate = stageAssistantText(event.stages, "logs");
    const previewCandidate = stageAssistantText(event.stages, "preview");
    if (finalCandidate) finalizedText = finalCandidate;
    if (previewCandidate) previewText = previewCandidate;

    if (type === "assistant") {
      const direct = extractText(event.content ?? event.message ?? event.text).trim();
      if (direct) finalizedText = direct;
    } else if (type === "stream_event") {
      const delta = extractText(event.delta ?? event.content ?? event.text);
      if (delta) streamedText += delta;
    }
  }
  return { text: finalizedText || previewText || streamedText, done };
}

function conolHeaders(cookie: string, extra?: Record<string, string>, sessionId?: string): Record<string, string> {
  return {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    cookie,
    origin: CONOL_ORIGIN,
    referer: sessionId ? `${CONOL_ORIGIN}/home?chat_session=${encodeURIComponent(sessionId)}` : `${CONOL_ORIGIN}/home`,
    "user-agent": USER_AGENT,
    ...extra,
  };
}

function safeTimezone(value: unknown): string {
  const explicit = readString(value);
  if (/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(explicit)) return explicit;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function normalizeConolCookie(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  return trimmed.includes("=") ? trimmed : `${CONOL_SESSION_COOKIE_NAME}=${trimmed}`;
}

function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
}

function completionResponse(text: string, model: string, sessionId: string, prompt: string): Response {
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(text);
  return new Response(JSON.stringify({
    id: `chatcmpl-conol-${sessionId}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function streamResponse(text: string, model: string, sessionId: string): Response {
  const encoder = new TextEncoder();
  const id = `chatcmpl-conol-${sessionId}`;
  const created = Math.floor(Date.now() / 1000);
  const readable = new ReadableStream({
    start(controller) {
      const chunks = [
        { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
        { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
      for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(readable, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

export class ConolWebExecutor extends BaseExecutor {
  constructor() {
    super("conol-web", PROVIDERS["conol-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = (Array.isArray(body?.messages) ? body.messages : []) as ChatMessage[];
    const prompt = buildConolPrompt(messages);
    if (!prompt) {
      return { response: errorResponse(400, "No user message found"), url: CONOL_SESSION_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const cookie = normalizeConolCookie(credentials.apiKey || "");
    if (!cookie) {
      return { response: errorResponse(401, "Missing Conol session cookie — sign in with the browser or paste the Cookie header"), url: CONOL_SESSION_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const { model: resolvedModel, effort, effortExplicit } = resolveConolModelSelection(model || body.model);
    const clientSessionKey = resolveConolClientSessionKey(body);
    const accountKey = credentials.connectionId ? `connection:${hashKey(credentials.connectionId)}` : `cookie:${hashKey(cookie)}`;
    const sessionBindingKey = clientSessionKey ? hashKey(`${accountKey}:${clientSessionKey}`) : null;
    const timeoutSignal = AbortSignal.timeout(CONOL_REQUEST_TIMEOUT_MS);
    const upstreamSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    log?.info?.("CONOL-WEB", `Query to ${resolvedModel}, effort=${effort}, boundSession=${!!sessionBindingKey}`);

    try {
      return await withConolSessionLock(sessionBindingKey, async () => {
        if (upstreamSignal.aborted) throw upstreamSignal.reason ?? new DOMException("Aborted", "AbortError");

        const cachedBinding = sessionBindingKey ? getConolSessionBinding(sessionBindingKey) : null;
        let sessionId = cachedBinding?.upstreamSessionId || "";
        let reusedSession = false;
        let presetApplied = cachedBinding?.presetApplied ?? false;
        let appliedModel = cachedBinding?.appliedModel ?? "";
        let appliedEffort: ConolEffort | null = cachedBinding?.appliedEffort ?? null;
        const timezone = safeTimezone(body.timezone);

        // Conol ignores agentModel/agentEffort on session creation, so create the
        // session empty and configure it before any turn is submitted.
        if (!sessionId) {
          const createResponse = await fetch(CONOL_SESSION_URL, {
            method: "POST",
            headers: conolHeaders(cookie, { "content-type": "application/json" }),
            body: JSON.stringify({ source: { type: "home" }, messages: [], timezone }),
            signal: upstreamSignal,
          });
          if (createResponse.status === 401 || createResponse.status === 403) {
            return { response: errorResponse(createResponse.status, "Conol session expired or is invalid — sign in again"), url: CONOL_SESSION_URL, headers: { cookie: "***" }, transformedBody: { model: resolvedModel } };
          }
          if (!createResponse.ok) {
            return { response: errorResponse(createResponse.status, `Conol session creation failed (HTTP ${createResponse.status})`), url: CONOL_SESSION_URL, headers: { cookie: "***" }, transformedBody: { model: resolvedModel } };
          }
          const created = (await createResponse.json()) as Record<string, unknown>;
          sessionId = readString(created.sessionId);
          if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            return { response: errorResponse(502, "Conol returned an invalid session identifier"), url: CONOL_SESSION_URL, headers: { cookie: "***" }, transformedBody: { model: resolvedModel } };
          }
          presetApplied = false;
          appliedModel = "";
          appliedEffort = null;
        }

        const plan = buildConolSessionModelPlan({ model: resolvedModel, effort, hasImageHistory: false });
        const desiredEffort = plan.effort?.agentEffort ?? null;
        const needsModelUpdate = !presetApplied || appliedModel !== resolvedModel || appliedEffort !== desiredEffort;
        if (needsModelUpdate) {
          const configured = await applyConolSessionModel({
            sessionId, plan, skipPreset: presetApplied,
            buildHeaders: (id) => conolHeaders(cookie, undefined, id),
            signal: upstreamSignal,
            onWarning: (message) => log?.warn?.("conol-web", message),
          });
          presetApplied = presetApplied || configured.presetApplied;
          if (configured.modelApplied) { appliedModel = resolvedModel; appliedEffort = configured.effortApplied; }
        }

        const turnUrl = `${CONOL_SESSION_URL}/${sessionId}/messages`;
        const turnResponse = await fetch(turnUrl, {
          method: "POST",
          headers: conolHeaders(cookie, { "content-type": "application/json" }, sessionId),
          body: JSON.stringify({ messages: [{ type: "text", content: prompt }], timezone }),
          signal: upstreamSignal,
        });
        if (turnResponse.status === 401 || turnResponse.status === 403) {
          return { response: errorResponse(turnResponse.status, "Conol session expired or is invalid — sign in again"), url: turnUrl, headers: { cookie: "***" }, transformedBody: { model: resolvedModel } };
        }
        if (cachedBinding && (turnResponse.status === 404 || turnResponse.status === 410)) {
          if (sessionBindingKey) conolSessionBindings.delete(sessionBindingKey);
          return { response: errorResponse(turnResponse.status, "Conol session no longer exists — retry to start a new session"), url: turnUrl, headers: { cookie: "***" }, transformedBody: { model: resolvedModel, sessionId } };
        }
        if (!turnResponse.ok) {
          return { response: errorResponse(turnResponse.status, `Conol message submission failed (HTTP ${turnResponse.status})`), url: turnUrl, headers: { cookie: "***" }, transformedBody: { model: resolvedModel, sessionId } };
        }
        reusedSession = !!cachedBinding && cachedBinding.upstreamSessionId === sessionId;
        await turnResponse.body?.cancel().catch(() => undefined);

        if (sessionBindingKey) {
          setConolSessionBinding(sessionBindingKey, { upstreamSessionId: sessionId, presetApplied, appliedModel, appliedEffort });
        }

        const messagesUrl = `${CONOL_SESSION_URL}/${sessionId}/messages?logDeltas=1`;
        const messageResponse = await fetch(messagesUrl, {
          method: "GET",
          headers: conolHeaders(cookie, { accept: "text/event-stream, application/x-ndjson" }, sessionId),
          signal: upstreamSignal,
        });
        if (!messageResponse.ok) {
          if (sessionBindingKey && (messageResponse.status === 404 || messageResponse.status === 410)) conolSessionBindings.delete(sessionBindingKey);
          return { response: errorResponse(messageResponse.status, `Conol message stream failed (HTTP ${messageResponse.status})`), url: messagesUrl, headers: { cookie: "***" }, transformedBody: { model: resolvedModel, sessionId } };
        }

        const parsed = parseConolMessageStream(await collectConolMessageStream(messageResponse));
        if (!parsed.text) {
          return { response: errorResponse(502, "Conol returned no assistant response"), url: messagesUrl, headers: { cookie: "***" }, transformedBody: { model: resolvedModel, sessionId } };
        }

        const response = stream ? streamResponse(parsed.text, resolvedModel, sessionId) : completionResponse(parsed.text, resolvedModel, sessionId, prompt);
        return {
          response, url: messagesUrl, headers: { cookie: "***" },
          transformedBody: { model: resolvedModel, ...(appliedEffort ? { effort: appliedEffort } : {}), effortRequested: effort, effortExplicit, sessionId, reusedSession, clientSessionBound: sessionBindingKey !== null },
        };
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "TimeoutError";
      const status = isTimeout ? 504 : 502;
      const message = isTimeout ? "Conol request timed out" : error instanceof Error && error.name === "AbortError" ? "Conol request was cancelled" : "Conol request failed";
      return { response: errorResponse(status, message), url: CONOL_SESSION_URL, headers: {} as Record<string, string>, transformedBody: { model: resolvedModel } };
    }
  }
}

export default ConolWebExecutor;
