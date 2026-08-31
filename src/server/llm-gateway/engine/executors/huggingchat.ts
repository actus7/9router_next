// HuggingChat (huggingface.co/chat) executor.
//
// HuggingChat's SvelteKit backend is a 3-step flow, not a single POST:
//   1. POST /chat/conversation { model } -> { conversationId }
//   2. GET  /chat/api/v2/conversations/{id} -> { rootMessageId }
//   3. POST /chat/conversation/{id} (multipart FormData: data=JSON{inputs,id})
//      -> NDJSON stream of MessageUpdate events (not SSE)
// The previous version of this executor POSTed straight to /chat/conversation
// with an OpenAI-shaped {model, inputs, parameters} JSON body and expected an
// immediate NDJSON response — the real endpoint only ever returns a
// conversationId there, so every request was fundamentally hitting the wrong
// step of the flow. Ported from OmniRoute's huggingchat.ts.
import { BaseExecutor } from "./base";
import type { Credentials, Logger } from "../services/types";
import { streamJsonlToOpenAi, readJsonlResponse } from "./huggingchat/jsonlStream";

const HUGGINGFACE_BASE = "https://huggingface.co";
const CONVERSATION_URL = `${HUGGINGFACE_BASE}/chat/conversation`;
const API_CONVERSATIONS_URL = `${HUGGINGFACE_BASE}/chat/api/v2/conversations`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const DEFAULT_MODEL = "baidu/ERNIE-4.5-VL-424B-A47B-Base-PT";
const FETCH_TIMEOUT_MS = 30_000;

function errorResponse(status: number, message: string, url: string, headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return {
    response: new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), { status, headers: { "Content-Type": "application/json" } }),
    url, headers, transformedBody: body,
  };
}

function normalizeCookieHeader(apiKey: string): string {
  const trimmed = String(apiKey ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("=")) return trimmed; // already a Cookie header (or fragment)
  return `hf-chat=${trimmed}`;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = part as Record<string, unknown>;
      if (item && (item.type === "text" || item.type === "input_text") && typeof item.text === "string") return item.text;
      return "";
    })
    .filter((p) => p.trim().length > 0)
    .join("\n")
    .trim();
}

function buildConversationPrompt(messages: Array<Record<string, unknown>>): { inputs: string; systemPrompt: string | null } {
  const systemParts: string[] = [];
  const conversationParts: Array<{ role: string; content: string }> = [];

  for (const msg of messages) {
    const role = String(msg.role || "user");
    const text = extractTextFromContent(msg.content);
    if (!text) continue;
    if (role === "system" || role === "developer") systemParts.push(text);
    else if (role === "user" || role === "assistant") conversationParts.push({ role, content: text });
  }

  if (conversationParts.length === 0) return { inputs: systemParts.join("\n\n"), systemPrompt: null };
  if (conversationParts.length === 1 && conversationParts[0].role === "user") {
    return { inputs: conversationParts[0].content, systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : null };
  }

  const lines = conversationParts.map((p) => `${p.role === "user" ? "User" : "Assistant"}: ${p.content}`);
  lines.push("Assistant:");
  return { inputs: lines.join("\n\n"), systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : null };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function getLocalTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const maybeGetSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === "function") return maybeGetSetCookie.call(headers).filter(Boolean);
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=)/).map((v) => v.trim()).filter(Boolean) : [];
}

function mergeCookieHeaderWithSetCookie(cookieHeader: string, setCookieHeaders: string[]): string {
  const cookieMap = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) cookieMap.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
  }
  for (const setCookie of setCookieHeaders) {
    const pair = setCookie.split(";", 1)[0]?.trim() || "";
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (value) cookieMap.set(name, value);
    }
  }
  return [...cookieMap.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function unwrapSuperjsonPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return record.json && typeof record.json === "object" ? record.json : value;
}

function extractInitialParentMessageId(value: unknown): string | null {
  const payload = unwrapSuperjsonPayload(value);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.rootMessageId === "string" && record.rootMessageId.trim()) return record.rootMessageId;
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const last = messages.at(-1) as Record<string, unknown> | undefined;
  return typeof last?.id === "string" && last.id.trim() ? last.id : null;
}

async function fetchInitialParentMessageId(conversationId: string, headers: Record<string, string>, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`${API_CONVERSATIONS_URL}/${conversationId}`, { method: "GET", headers, signal });
  if (!res.ok) return null;
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return extractInitialParentMessageId(JSON.parse(text)); } catch { return null; }
}

export class HuggingChatExecutor extends BaseExecutor {
  constructor() {
    super("huggingchat", { baseUrl: HUGGINGFACE_BASE });
  }

  async execute({ model, body, stream: wantStream, credentials, signal, log }: {
    model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger;
  }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return errorResponse(400, "Missing or empty messages array", CONVERSATION_URL);
    }

    let cookieHeader = normalizeCookieHeader(String(credentials.apiKey ?? ""));
    if (!cookieHeader) {
      return errorResponse(400, "HuggingChat requires a session cookie. Log in to huggingface.co/chat, open DevTools > Application > Cookies, and copy the hf-chat cookie value.", CONVERSATION_URL);
    }

    const resolvedModel = model || DEFAULT_MODEL;
    const { inputs, systemPrompt } = buildConversationPrompt(messages);
    if (!inputs.trim()) {
      return errorResponse(400, "Empty prompt after processing messages", CONVERSATION_URL);
    }

    const baseHeaders: Record<string, string> = {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      Origin: HUGGINGFACE_BASE,
      Referer: `${HUGGINGFACE_BASE}/chat/`,
    };

    const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    // -- Step 1: Create conversation --
    let conversationId: string;
    try {
      const createBody: Record<string, unknown> = { model: resolvedModel };
      if (systemPrompt) createBody.preprompt = systemPrompt;

      const createRes = await fetch(CONVERSATION_URL, {
        method: "POST", headers: { ...baseHeaders, "Content-Type": "application/json" }, body: JSON.stringify(createBody), signal: combinedSignal,
      });

      if (!createRes.ok) {
        const status = createRes.status;
        const errText = await createRes.text().catch(() => "");
        let message = errText || `HuggingChat conversation creation failed (HTTP ${status})`;
        if (status === 401 || status === 403) message = "HuggingChat auth failed — your hf-chat session cookie may be missing or expired. Log in to huggingface.co/chat and re-paste your cookie.";
        else if (status === 429) message = "HuggingChat rate limited. Wait a moment and retry.";
        log?.warn?.("HUGGINGCHAT", message);
        return errorResponse(status, message, CONVERSATION_URL, baseHeaders, body);
      }

      const createData = (await createRes.json()) as Record<string, unknown>;
      conversationId = createData.conversationId as string;
      cookieHeader = mergeCookieHeaderWithSetCookie(cookieHeader, getSetCookieHeaders(createRes.headers));
      baseHeaders.Cookie = cookieHeader;

      if (!conversationId) {
        return errorResponse(502, "HuggingChat did not return a conversationId", CONVERSATION_URL, baseHeaders, body);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log?.error?.("HUGGINGCHAT", `Conversation creation failed: ${message}`);
      return errorResponse(502, `HuggingChat connection failed: ${message}`, CONVERSATION_URL, baseHeaders, body);
    }

    // -- Step 2: Fetch the root message id to reply to --
    const parentMessageId = await fetchInitialParentMessageId(conversationId, baseHeaders, combinedSignal);
    if (!parentMessageId) {
      return errorResponse(502, "HuggingChat did not return an initial parent message id", `${API_CONVERSATIONS_URL}/${conversationId}`, baseHeaders, body);
    }

    // -- Step 3: Send the message --
    const messageUrl = `${CONVERSATION_URL}/${conversationId}`;
    const sendDataPayload: Record<string, unknown> = {
      inputs, is_retry: false, is_continue: false, generationId: crypto.randomUUID(),
      selectedMcpServerNames: [], selectedMcpServers: [], timezone: getLocalTimezone(), id: parentMessageId,
    };
    const formData = new FormData();
    formData.append("data", JSON.stringify(sendDataPayload));

    log?.info?.("HUGGINGCHAT", `Query to ${resolvedModel}, conversation=${conversationId}`);

    let upstream: Response;
    try {
      upstream = await fetch(messageUrl, { method: "POST", headers: baseHeaders, body: formData, signal: combinedSignal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log?.error?.("HUGGINGCHAT", `Message send failed: ${message}`);
      return errorResponse(502, `HuggingChat connection failed: ${message}`, messageUrl, baseHeaders, sendDataPayload);
    }

    if (!upstream.ok) {
      const status = upstream.status;
      const errText = await upstream.text().catch(() => "");
      let message = errText || `HuggingChat returned HTTP ${status}`;
      if (status === 401 || status === 403) message = "HuggingChat auth failed — session cookie may be expired.";
      else if (status === 429) message = "HuggingChat rate limited. Wait a moment and retry.";
      else if (status === 404) message = `HuggingChat model not found: ${resolvedModel}. Check the model ID.`;
      return errorResponse(status, message, messageUrl, baseHeaders, sendDataPayload);
    }

    if (!upstream.body) {
      return errorResponse(502, "HuggingChat returned empty response body", messageUrl, baseHeaders, sendDataPayload);
    }

    const id = `chatcmpl-huggingchat-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (wantStream) {
      const encoder = new TextEncoder();
      const jsonlStream = streamJsonlToOpenAi(upstream.body, resolvedModel, id, created, signal);
      const sseStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of jsonlStream) controller.enqueue(encoder.encode(chunk));
          } catch (err) {
            log?.error?.("HUGGINGCHAT", `Stream error: ${err}`);
          } finally {
            controller.close();
          }
        },
      });
      return {
        response: new Response(sseStream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } }),
        url: messageUrl, headers: baseHeaders, transformedBody: sendDataPayload,
      };
    }

    const fullText = await readJsonlResponse(upstream.body, signal);
    const completionTokens = estimateTokens(fullText);
    return {
      response: new Response(JSON.stringify({
        id, object: "chat.completion", created, model: resolvedModel,
        choices: [{ index: 0, message: { role: "assistant", content: fullText }, finish_reason: "stop" }],
        usage: { prompt_tokens: estimateTokens(inputs), completion_tokens: completionTokens, total_tokens: estimateTokens(inputs) + completionTokens },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      url: messageUrl, headers: baseHeaders, transformedBody: sendDataPayload,
    };
  }
}

export default HuggingChatExecutor;
