import { createHash } from "node:crypto";
import WebSocket from "ws";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

// Microsoft Copilot Web is a WebSocket protocol, not a single-call SSE
// pass-through (our previous executor's assumption): POST /c/api/start for a
// conversationId + session cookies, then a WS connection to /c/api/chat
// exchanging {event:"send"/"appendText"/"done"/"challenge"...} JSON events.
const COPILOT_BASE = "https://copilot.microsoft.com";
const COPILOT_START_URL = `${COPILOT_BASE}/c/api/start`;
const COPILOT_WS_URL = "wss://copilot.microsoft.com/c/api/chat?api-version=2";
const COPILOT_WS_TIMEOUT_MS = 90_000;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const MODEL_MODE_MAP: Record<string, string> = {
  copilot: "chat",
  "copilot-chat": "chat",
  "gpt-4o": "chat",
  "gpt-4": "chat",
  "copilot-think": "reasoning",
  "copilot-think-deeper": "reasoning",
  o1: "reasoning",
  o3: "reasoning",
  "copilot-smart": "smart",
  "copilot-gpt5": "smart",
  "gpt-5": "smart",
  "copilot-study": "chat",
};
const DEFAULT_MODE = "chat";

function getCopilotMode(model?: string): string {
  if (!model) return DEFAULT_MODE;
  return MODEL_MODE_MAP[model.toLowerCase()] || DEFAULT_MODE;
}

// Hashcash difficulty cap — clamps a malicious/buggy server's difficulty
// value so it can't force huge prefix allocations. 8 hex zeros already sits
// far beyond the iteration budget below.
const MAX_HASHCASH_DIFFICULTY = 8;
const HASHCASH_MAX_ITERATIONS = 10_000_000;

function solveHashcash(parameter: string, difficulty: number): number | null {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > MAX_HASHCASH_DIFFICULTY) return null;
  const prefix = "0".repeat(difficulty);
  for (let i = 0; i < HASHCASH_MAX_ITERATIONS; i++) {
    const hash = createHash("sha256").update(`${parameter}:${i}`).digest("hex");
    if (hash.startsWith(prefix)) return i;
  }
  return null;
}

/** Extract an OAuth access_token from a pasted credential — rejects a bare
 * cookie header (not an access token) instead of forwarding it as Bearer. */
function extractAccessToken(credential: string): string | null {
  const trimmed = credential?.trim();
  if (!trimmed) return null;
  const accessTokenMatch = trimmed.match(/(?:^|[\s;,{"'])access_token\s*[=:]\s*["']?([^\s;,}"']+)/i);
  if (accessTokenMatch) return accessTokenMatch[1];
  const bearerMatch = trimmed.match(/(?:^|[\s:{"'])bearer\s+([^\s,}"';]+)/i);
  if (bearerMatch) return bearerMatch[1];
  if (/^(?:[^=;\s]+=[^;]*)(?:;|$)/.test(trimmed) || /^(?:\{|\[)/.test(trimmed)) return null;
  return trimmed;
}

function buildCopilotWebSocketUrl(accessToken?: string): string {
  const url = new URL(COPILOT_WS_URL);
  url.searchParams.set("clientSessionId", crypto.randomUUID());
  // The browser client authenticates the WS via this query param — Node's
  // `ws` package could set a header instead, but the query param works for
  // both transports and matches the real client's own behavior.
  if (accessToken) url.searchParams.set("accessToken", accessToken);
  return url.toString();
}

function sessionPoolKey(token?: string): string {
  return token && token.length > 0 ? token : "anonymous";
}

// ── Session pool (rotates when a session's turn budget runs low or it's blocked) ──

interface CopilotSession {
  conversationId: string;
  remainingTurns: number;
  isBlocked: boolean;
  createdAt: number;
}
const sessionPool = new Map<string, CopilotSession>();
const MIN_REMAINING_TURNS = 5;
const MAX_POOL_SIZE = 100;
const SESSION_MAX_AGE_MS = 3_600_000;

async function createSession(accessToken: string | undefined, signal: AbortSignal | undefined): Promise<CopilotSession> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": USER_AGENT, Origin: COPILOT_BASE, Referer: `${COPILOT_BASE}/` };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(COPILOT_START_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ timeZone: "America/New_York", startNewConversation: true, teenSupportEnabled: false }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Copilot /c/api/start failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { currentConversationId?: string; conversationId?: string; remainingTurns?: number; isBlocked?: boolean };
  const convId = data.currentConversationId || data.conversationId;
  if (!convId) throw new Error("Copilot /c/api/start returned no conversationId");

  return { conversationId: convId, remainingTurns: data.remainingTurns ?? 1000, isBlocked: data.isBlocked ?? false, createdAt: Date.now() };
}

async function getSession(accessToken: string | undefined, signal: AbortSignal | undefined): Promise<CopilotSession> {
  const poolKey = sessionPoolKey(accessToken);
  const existing = sessionPool.get(poolKey);
  if (existing && !existing.isBlocked && existing.remainingTurns > MIN_REMAINING_TURNS && Date.now() - existing.createdAt < SESSION_MAX_AGE_MS) {
    return existing;
  }
  const session = await createSession(accessToken, signal);
  if (sessionPool.size >= MAX_POOL_SIZE) {
    const oldest = sessionPool.keys().next().value;
    if (oldest) sessionPool.delete(oldest);
  }
  sessionPool.set(poolKey, session);
  return session;
}

// ── WS chat ───────────────────────────────────────────────────────────────

interface CopilotWsEvent {
  event: string;
  text?: string;
  url?: string;
  title?: string;
  suggestions?: string[];
  error?: string;
  method?: string;
  parameter?: string;
}

function wsChat(conversationId: string, prompt: string, mode: string, model: string, accessToken: string | undefined, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const wsUrl = buildCopilotWebSocketUrl(accessToken);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let ws: WebSocket | null = null;
      let settled = false;

      const cleanup = () => { if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; } };
      const chunk = (delta: object, finish: string | null = null) => ({
        id: `chatcmpl-copilot-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };
      const abort = (reason?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (reason) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: reason } })}\n\n`));
        controller.close();
      };

      signal?.addEventListener("abort", () => abort("Request aborted"), { once: true });

      try {
        ws = new WebSocket(wsUrl, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
        const timeout = setTimeout(() => abort("Copilot WebSocket timeout"), COPILOT_WS_TIMEOUT_MS);

        let chatSent = false;
        const sendChat = () => {
          if (chatSent) return;
          chatSent = true;
          ws?.send(JSON.stringify({ event: "send", conversationId, content: [{ type: "text", text: prompt }], mode }));
        };

        ws.onopen = () => sendChat();

        ws.onmessage = (ev: WebSocket.MessageEvent) => {
          try {
            const event: CopilotWsEvent = typeof ev.data === "string" ? JSON.parse(ev.data) : JSON.parse(String(ev.data));
            switch (event.event) {
              case "challenge": {
                if (event.method === "hashcash" && event.parameter) {
                  const [param, diffStr] = String(event.parameter).split(":");
                  const solution = solveHashcash(param, parseInt(diffStr || "1", 10));
                  ws?.send(JSON.stringify({ event: "challengeResponse", token: solution !== null ? String(solution) : "", method: "hashcash" }));
                  chatSent = false;
                  sendChat();
                } else if (event.method === "cloudflare") {
                  abort("Copilot requires Cloudflare Turnstile verification. Use an authenticated session (access_token) instead.");
                } else {
                  abort(`Copilot challenge "${event.method}" not supported. Use an authenticated session.`);
                }
                break;
              }
              case "appendText":
              case "replaceText": {
                if (event.text) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ content: event.text }))}\n\n`));
                break;
              }
              case "chainOfThought": {
                if (event.text) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ reasoning_content: event.text }))}\n\n`));
                break;
              }
              case "imageGenerated": {
                if (event.url) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ content: [{ type: "image_url", image_url: { url: event.url, detail: "auto" } }] }))}\n\n`));
                break;
              }
              case "citation": {
                if (event.url) {
                  const annotation = { type: "url_citation", url_citation: { url: event.url, title: event.title || event.url } };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ annotations: [annotation] }))}\n\n`));
                }
                break;
              }
              case "suggestedFollowups": {
                if (Array.isArray(event.suggestions) && event.suggestions.length > 0) {
                  const text = `\n\n**Suggested follow-ups:**\n${event.suggestions.map((s) => `- ${s}`).join("\n")}`;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ content: text }))}\n\n`));
                }
                break;
              }
              case "done": {
                clearTimeout(timeout);
                finish();
                break;
              }
              case "error": {
                clearTimeout(timeout);
                abort(event.error || "Copilot stream error");
                break;
              }
              default:
                break;
            }
          } catch {
            // Skip unparseable messages.
          }
        };

        ws.onerror = (err: WebSocket.ErrorEvent) => {
          clearTimeout(timeout);
          abort(err.message || "Copilot WebSocket error");
        };
        ws.onclose = () => {
          clearTimeout(timeout);
          finish();
        };
      } catch (err) {
        abort(err instanceof Error ? err.message : "Failed to connect to Copilot");
      }
    },
  });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status, headers: { "Content-Type": "application/json" } });
}

export class CopilotWebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-web", PROVIDERS["copilot-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const resolvedModel = model || (body?.model as string) || "copilot";
    const mode = getCopilotMode(resolvedModel);
    const wantStream = stream !== false;

    const rawCred = credentials.apiKey || (credentials.providerSpecificData?.cookie as string) || "";
    const accessToken = extractAccessToken(rawCred);

    const messages = (body?.messages as Array<Record<string, unknown>>) || [];
    const userMsg = messages.filter((m) => m.role === "user").pop();
    const systemMsgs = messages.filter((m) => m.role === "system");
    const prompt = (userMsg?.content as string) || "";
    if (!prompt || !prompt.trim()) {
      return { response: errorResponse(400, "No user message provided"), url: COPILOT_START_URL, headers: {} as Record<string, string>, transformedBody: {} };
    }

    let fullPrompt = "";
    if (systemMsgs.length > 0) {
      const sysText = systemMsgs.map((m) => (typeof m.content === "string" ? m.content : "")).filter(Boolean).join("\n");
      if (sysText) fullPrompt += `[System Instructions]\n${sysText}\n\n`;
    }
    fullPrompt += prompt;

    log?.info?.("COPILOT-WEB", `Starting session, mode=${mode}`);

    let conversationId: string;
    try {
      const session = await getSession(accessToken || undefined, signal);
      conversationId = session.conversationId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start Copilot conversation";
      return { response: errorResponse(502, msg), url: COPILOT_START_URL, headers: {} as Record<string, string>, transformedBody: { mode, prompt: fullPrompt.slice(0, 100) } };
    }

    if (!wantStream) {
      const wsStream = wsChat(conversationId, fullPrompt, mode, resolvedModel, accessToken || undefined, signal);
      const reader = wsStream.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const delta = JSON.parse(data)?.choices?.[0]?.delta;
              if (typeof delta?.content === "string") fullText += delta.content;
            } catch { /* skip */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
      return {
        response: new Response(JSON.stringify({
          id: `chatcmpl-copilot-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: resolvedModel,
          choices: [{ index: 0, message: { role: "assistant", content: fullText || "(empty response)" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }), { headers: { "Content-Type": "application/json" } }),
        url: COPILOT_WS_URL, headers: {} as Record<string, string>, transformedBody: { conversationId, mode, prompt: fullPrompt.slice(0, 100) },
      };
    }

    const wsStream = wsChat(conversationId, fullPrompt, mode, resolvedModel, accessToken || undefined, signal);
    return {
      response: new Response(wsStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
      url: COPILOT_WS_URL, headers: {} as Record<string, string>, transformedBody: { conversationId, mode, prompt: fullPrompt.slice(0, 100) },
    };
  }
}

export default CopilotWebExecutor;
