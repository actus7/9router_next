import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

// Adapta's real product lives at agent.adapta.one (not adapta.org) behind a
// Clerk-authenticated session — the __client cookie only unlocks a Clerk
// client, which must be exchanged for a short-lived session JWT before any
// chat call. Our previous pass-through executor skipped that exchange
// entirely and posted an OpenAI-shaped body to a URL that doesn't exist.
const ADAPTA_APP_URL = "https://agent.adapta.one";
const ADAPTA_CLERK_URL = "https://clerk.agent.adapta.one";
const ADAPTA_STREAM_URL = `${ADAPTA_APP_URL}/api/chat/stream/v1`;
const DEFAULT_AI_MODEL_ID = 14; // "ONE" (auto-select)
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// ── In-memory Clerk session cache (keyed by the first 32 chars of the __client JWT) ──

interface CachedSession {
  sessionId: string;
  jwt: string;
  jwtExpiresAt: number;
}
const sessionCache = new Map<string, CachedSession>();

function cacheKey(clientJwt: string): string {
  return clientJwt.slice(0, 32);
}

function cachedJwt(clientJwt: string): string | null {
  const entry = sessionCache.get(cacheKey(clientJwt));
  if (!entry) return null;
  if (Date.now() >= entry.jwtExpiresAt - 30_000) return null;
  return entry.jwt;
}

function storeSession(clientJwt: string, sessionId: string, jwt: string, expMs: number): void {
  sessionCache.set(cacheKey(clientJwt), { sessionId, jwt, jwtExpiresAt: expMs });
}

function extractClientJwt(rawApiKey: string): string {
  const trimmed = rawApiKey.trim();
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0 && !trimmed.startsWith("eyJ")) return trimmed.slice(eqIdx + 1).trim();
  return trimmed;
}

/** Decode the exp claim from a JWT without verifying signature. */
function jwtExpMs(jwt: string): number {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return 0;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// ── Clerk auth flow ──────────────────────────────────────────────────────────

/** Step 1: GET /v1/client → active Clerk session id. */
async function getSessionId(clientJwt: string, signal?: AbortSignal, log?: Logger): Promise<string> {
  const resp = await fetch(`${ADAPTA_CLERK_URL}/v1/client`, {
    headers: { Cookie: `__client=${clientJwt}`, "User-Agent": USER_AGENT, Origin: ADAPTA_APP_URL },
    signal,
  });
  if (!resp.ok) throw new Error(`Clerk /v1/client returned HTTP ${resp.status} — check your __client cookie`);
  const body = await resp.json();
  const sessions: Array<{ id: string; status: string }> = body?.response?.sessions ?? [];
  const active = sessions.find((s) => s.status === "active");
  if (!active?.id) throw new Error("No active Clerk session found — your __client cookie may be expired or invalid");
  log?.info?.("ADAPTA-WEB", `Got session ID: ${active.id}`);
  return active.id;
}

/** Step 2: POST /v1/client/sessions/{id}/tokens → fresh short-lived JWT. */
async function refreshSessionJwt(clientJwt: string, sessionId: string, signal?: AbortSignal, log?: Logger): Promise<string> {
  const resp = await fetch(`${ADAPTA_CLERK_URL}/v1/client/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers: { Cookie: `__client=${clientJwt}`, "Content-Type": "application/json", "User-Agent": USER_AGENT, Origin: ADAPTA_APP_URL },
    signal,
  });
  if (!resp.ok) throw new Error(`Clerk token refresh returned HTTP ${resp.status}`);
  const body = await resp.json();
  const jwt = body?.jwt;
  if (typeof jwt !== "string" || !jwt.startsWith("eyJ")) throw new Error("Clerk token refresh did not return a valid JWT");
  log?.info?.("ADAPTA-WEB", `Got fresh session JWT (${jwt.length} chars)`);
  return jwt;
}

async function getSessionJwt(clientJwt: string, signal?: AbortSignal, log?: Logger): Promise<string> {
  const cached = cachedJwt(clientJwt);
  if (cached) {
    log?.info?.("ADAPTA-WEB", "Using cached session JWT");
    return cached;
  }
  const sessionId = await getSessionId(clientJwt, signal, log);
  const jwt = await refreshSessionJwt(clientJwt, sessionId, signal, log);
  storeSession(clientJwt, sessionId, jwt, jwtExpMs(jwt) || Date.now() + 55_000);
  return jwt;
}

// ── Request translation ──────────────────────────────────────────────────────

interface AdaptaMessage {
  role: string;
  parts: Array<{ type: "text"; text: string }>;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => String(c.text ?? "")).join("");
  }
  return String(content ?? "");
}

/** Build the Adapta messages array, injecting the system prompt into the first user message. */
function buildAdaptaMessages(messages: Array<{ role: string; content: unknown }>): AdaptaMessage[] {
  let systemText = "";
  const rest: Array<{ role: string; content: unknown }> = [];
  for (const msg of messages) {
    const role = msg.role === "developer" ? "system" : msg.role;
    if (role === "system") systemText += (systemText ? "\n" : "") + extractText(msg.content);
    else rest.push(msg);
  }

  const adapted: AdaptaMessage[] = [];
  let systemInjected = false;
  for (const msg of rest) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = extractText(msg.content);
    if (!text.trim()) continue;
    if (!systemInjected && systemText && msg.role === "user") {
      adapted.push({ role: "user", parts: [{ type: "text", text: `${systemText}\n\n${text}` }] });
      systemInjected = true;
    } else {
      adapted.push({ role: msg.role, parts: [{ type: "text", text }] });
    }
  }
  return adapted;
}

// ── SSE translation: Adapta → OpenAI ─────────────────────────────────────────

function transformStream(adaptaStream: ReadableStream, model: string): ReadableStream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-adp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let roleEmitted = false;

  return new ReadableStream({
    async start(controller) {
      const reader = adaptaStream.getReader();
      let buffer = "";
      const emit = (obj: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const chunk = (delta: object, finish?: string) => emit({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
      const ensureRole = () => { if (!roleEmitted) { roleEmitted = true; chunk({ role: "assistant", content: "" }); } };
      const finalize = () => {
        ensureRole();
        chunk({}, "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;
            let event: Record<string, unknown>;
            try { event = JSON.parse(payload); } catch { continue; }
            const type = event.type as string;

            if (type === "text-delta") {
              // Suppress the "quick-response" loading placeholder.
              if (event.id === "quick-response") continue;
              const delta = event.delta as string;
              if (typeof delta === "string" && delta.length > 0) { ensureRole(); chunk({ content: delta }); }
            } else if (type === "error") {
              const errText = String(event.errorText ?? "Adapta upstream error");
              ensureRole();
              chunk({ content: `\n\n[Error: ${errText}]` });
              finalize();
              return;
            } else if (type === "done" || type === "end") {
              finalize();
              return;
            }
          }
        }
      } catch {
        // Stream aborted or network error — emit what we have.
      }
      finalize();
    },
  });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
}

export class AdaptaWebExecutor extends BaseExecutor {
  constructor() {
    super("adapta-web", PROVIDERS["adapta-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = (Array.isArray(body?.messages) ? body.messages : []) as Array<{ role: string; content: unknown }>;

    const rawKey = credentials.apiKey || "";
    if (!rawKey) {
      return { response: errorResponse(401, "Missing Adapta credentials — paste your __client cookie from .clerk.agent.adapta.one"), url: ADAPTA_STREAM_URL, headers: {} as Record<string, string>, transformedBody: body };
    }
    const clientJwt = extractClientJwt(rawKey);

    let sessionJwt: string;
    try {
      log?.info?.("ADAPTA-WEB", "Obtaining session JWT via Clerk...");
      sessionJwt = await getSessionJwt(clientJwt, signal, log);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn?.("ADAPTA-WEB", `Auth failed: ${msg}`);
      return { response: errorResponse(401, `Adapta auth failed: ${msg}`), url: ADAPTA_STREAM_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const aiModelId = DEFAULT_AI_MODEL_ID;
    const adaptaMessages = buildAdaptaMessages(messages);
    if (adaptaMessages.length === 0) {
      return { response: errorResponse(400, "No messages provided"), url: ADAPTA_STREAM_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const requestPayload = { messages: adaptaMessages, aiModelId };
    const headers: Record<string, string> = {
      Authorization: `Bearer ${sessionJwt}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
      Referer: `${ADAPTA_APP_URL}/agentic-chat`,
    };

    log?.info?.("ADAPTA-WEB", `Query to ${model}, aiModelId=${aiModelId}, msgs=${adaptaMessages.length}`);

    const resp = await fetch(ADAPTA_STREAM_URL, { method: "POST", headers, body: JSON.stringify(requestPayload), signal });

    if (!resp.ok) {
      let errMsg = `Adapta error HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403) {
        errMsg = "Adapta session expired or invalid — re-paste your __client cookie from .clerk.agent.adapta.one";
        sessionCache.delete(cacheKey(clientJwt));
      } else if (resp.status === 429) {
        errMsg = "Adapta rate limited — wait and retry";
      }
      log?.warn?.("ADAPTA-WEB", errMsg);
      return { response: errorResponse(resp.status, errMsg), url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload };
    }

    if (!resp.body) {
      return { response: errorResponse(502, "Adapta returned empty response body"), url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload };
    }

    if (stream !== false) {
      return {
        response: new Response(transformStream(resp.body, model), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload,
      };
    }

    const decoder = new TextDecoder();
    const reader = resp.body.getReader();
    let buf = "";
    let fullText = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "text-delta" && ev.id !== "quick-response") fullText += String(ev.delta ?? "");
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      response: new Response(JSON.stringify({
        id: `chatcmpl-adp-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: "assistant", content: fullText }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      url: ADAPTA_STREAM_URL, headers, transformedBody: requestPayload,
    };
  }
}

export default AdaptaWebExecutor;
