import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

// Tencent Yuanbao is NOT a single-call OpenAI pass-through (our previous
// executor's assumption) — the real flow is two steps: create a conversation,
// then POST a Yuanbao-shaped chat body to /api/chat/{conversationId} and
// translate its custom {type:"think"|"text"} SSE events to OpenAI chunks.
const YUANBAO_BASE = PROVIDERS["yuanbao-web"].baseUrl as string;
const CREATE_URL = `${YUANBAO_BASE}/api/user/agent/conversation/create`;
const CHAT_URL = `${YUANBAO_BASE}/api/chat`;
// Public default DeepSeek agent id used by the Yuanbao web app — not a secret,
// it's the shared consumer agent every logged-in session addresses by default.
const DEFAULT_AGENT_ID = "naQivTmsDa";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const DEFAULT_MODEL = "deepseek-v3";

const MODEL_MAP: Record<string, { chatModelId: string; supportFunctions?: string[] }> = {
  "deepseek-v3": { chatModelId: "deep_seek_v3" },
  "deepseek-r1": { chatModelId: "deep_seek" },
  "deepseek-v3-search": { chatModelId: "deep_seek_v3", supportFunctions: ["supportInternetSearch"] },
  "deepseek-r1-search": { chatModelId: "deep_seek", supportFunctions: ["supportInternetSearch"] },
  hunyuan: { chatModelId: "hunyuan_gpt_175B_0404" },
  "hunyuan-t1": { chatModelId: "hunyuan_t1" },
  "hunyuan-search": { chatModelId: "hunyuan_gpt_175B_0404", supportFunctions: ["supportInternetSearch"] },
  "hunyuan-t1-search": { chatModelId: "hunyuan_t1", supportFunctions: ["supportInternetSearch"] },
};

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part: unknown) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return (item.type === "text" || item.type === "input_text") && typeof item.text === "string" ? item.text : "";
    })
    .filter((p: string) => p.length > 0)
    .join("\n");
}

/** Flatten OpenAI messages into the single-prompt shape Yuanbao expects. */
function buildPrompt(messages: Array<Record<string, unknown>>): string {
  const parts: Array<{ role: string; content: string }> = [];
  for (const msg of messages) {
    const text = extractText(msg.content).trim();
    if (!text) continue;
    parts.push({ role: String(msg.role || "user"), content: text });
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].content;
  return parts.map((p) => `#[${p.role.trim()}]\n${p.content}`).join("\n\n");
}

/** Build the `hy_source=web; hy_user=...; hy_token=...` cookie from the pasted header. */
function buildYuanbaoCookie(rawApiKey: string): { cookie: string; hasToken: boolean } {
  const raw = (rawApiKey || "").trim();
  const userMatch = raw.match(/hy_user=([^;]+)/);
  const tokenMatch = raw.match(/hy_token=([^;]+)/);
  if (userMatch && tokenMatch) {
    return { cookie: `hy_source=web; hy_user=${userMatch[1]}; hy_token=${tokenMatch[1]}`, hasToken: true };
  }
  return { cookie: raw, hasToken: raw.includes("hy_token=") };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), { status, headers: { "Content-Type": "application/json" } });
}

interface YuanbaoEvent {
  type?: string;
  content?: string;
  msg?: string;
}

function parseYuanbaoDataLine(line: string): YuanbaoEvent | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (!payload || payload === "[DONE]" || !payload.startsWith("{")) return null;
  try {
    return JSON.parse(payload) as YuanbaoEvent;
  } catch {
    return null;
  }
}

function transformYuanbaoStream(upstream: ReadableStream<Uint8Array>, model: string, id: string, created: number, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let roleEmitted = false;
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      const emit = (delta: object, finish?: string | null) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`));
      };
      const ensureRole = () => {
        if (!roleEmitted) { roleEmitted = true; emit({ role: "assistant", content: "" }); }
      };
      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = parseYuanbaoDataLine(line);
            if (!event) continue;
            if (event.type === "think" && event.content) {
              ensureRole();
              emit({ reasoning_content: event.content });
            } else if (event.type === "text") {
              const text = event.msg ?? event.content;
              if (text) { ensureRole(); emit({ content: text }); }
            }
          }
        }
      } finally {
        ensureRole();
        emit({}, "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

async function collectYuanbaoResponse(upstream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<{ content: string; reasoning: string }> {
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  let buffer = "";
  let content = "";
  let reasoning = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseYuanbaoDataLine(line);
        if (!event) continue;
        if (event.type === "think" && event.content) reasoning += event.content;
        else if (event.type === "text") {
          const text = event.msg ?? event.content;
          if (text) content += text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { content, reasoning };
}

export class YuanbaoWebExecutor extends BaseExecutor {
  constructor() {
    super("yuanbao-web", PROVIDERS["yuanbao-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { response: errorResponse(400, "Missing or empty messages array"), url: CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const { cookie, hasToken } = buildYuanbaoCookie(credentials.apiKey || "");
    if (!hasToken) {
      return {
        response: errorResponse(401, "Yuanbao requires a session cookie. Log in to yuanbao.tencent.com, open DevTools > Application > Cookies, and paste the full Cookie header (it must contain hy_user and hy_token)."),
        url: CREATE_URL, headers: {} as Record<string, string>, transformedBody: body,
      };
    }

    const resolvedModel = model && MODEL_MAP[model] ? model : DEFAULT_MODEL;
    const modelSpec = MODEL_MAP[resolvedModel];
    const prompt = buildPrompt(messages);
    if (!prompt.trim()) {
      return { response: errorResponse(400, "Empty prompt after processing messages"), url: CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const baseHeaders: Record<string, string> = {
      Cookie: cookie,
      "User-Agent": USER_AGENT,
      Origin: YUANBAO_BASE,
      Referer: `${YUANBAO_BASE}/chat/${DEFAULT_AGENT_ID}`,
      "X-Agentid": DEFAULT_AGENT_ID,
    };

    log?.info?.("YUANBAO-WEB", `Creating conversation for agent ${DEFAULT_AGENT_ID}`);

    let conversationId: string;
    try {
      const createRes = await fetch(CREATE_URL, {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: DEFAULT_AGENT_ID }),
        signal,
      });
      if (!createRes.ok) {
        const status = createRes.status;
        let msg = `Yuanbao conversation creation failed (HTTP ${status})`;
        if (status === 401 || status === 403) msg = "Yuanbao auth failed — your hy_user/hy_token cookies may be missing or expired. Log in to yuanbao.tencent.com and re-paste your Cookie header.";
        else if (status === 429) msg = "Yuanbao rate limited. Wait a moment and retry.";
        return { response: errorResponse(status, msg), url: CREATE_URL, headers: baseHeaders, transformedBody: body };
      }
      const createData = (await createRes.json()) as Record<string, unknown>;
      conversationId = String(createData.id || "");
      if (!conversationId) {
        return { response: errorResponse(502, "Yuanbao did not return a conversation id"), url: CREATE_URL, headers: baseHeaders, transformedBody: body };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("YUANBAO-WEB", `Conversation creation failed: ${errMsg}`);
      return { response: errorResponse(502, `Yuanbao connection failed: ${errMsg}`), url: CREATE_URL, headers: baseHeaders, transformedBody: body };
    }

    const messageUrl = `${CHAT_URL}/${conversationId}`;
    const chatBody: Record<string, unknown> = {
      model: "gpt_175B_0404",
      prompt,
      plugin: "Adaptive",
      displayPrompt: prompt,
      displayPromptType: 1,
      options: { imageIntention: { needIntentionModel: true, backendUpdateFlag: 2, intentionStatus: true } },
      multimedia: [],
      agentId: DEFAULT_AGENT_ID,
      supportHint: 1,
      version: "v2",
      chatModelId: modelSpec.chatModelId,
    };
    if (modelSpec.supportFunctions) chatBody.supportFunctions = modelSpec.supportFunctions;

    const chatHeaders: Record<string, string> = { ...baseHeaders, "Content-Type": "application/json", Accept: "text/event-stream" };

    log?.info?.("YUANBAO-WEB", `Query to ${resolvedModel} (${modelSpec.chatModelId})`);

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(messageUrl, { method: "POST", headers: chatHeaders, body: JSON.stringify(chatBody), signal });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("YUANBAO-WEB", `Message send failed: ${errMsg}`);
      return { response: errorResponse(502, `Yuanbao connection failed: ${errMsg}`), url: messageUrl, headers: chatHeaders, transformedBody: chatBody };
    }

    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status;
      let msg = `Yuanbao returned HTTP ${status}`;
      if (status === 401 || status === 403) msg = "Yuanbao auth failed — session cookie may be expired.";
      else if (status === 429) msg = "Yuanbao rate limited. Wait a moment and retry.";
      return { response: errorResponse(status, msg), url: messageUrl, headers: chatHeaders, transformedBody: chatBody };
    }

    if (!upstreamResponse.body) {
      return { response: errorResponse(502, "Yuanbao returned empty response body"), url: messageUrl, headers: chatHeaders, transformedBody: chatBody };
    }

    const id = `chatcmpl-yuanbao-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      return {
        response: new Response(transformYuanbaoStream(upstreamResponse.body, resolvedModel, id, created, signal), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } }),
        url: messageUrl, headers: chatHeaders, transformedBody: chatBody,
      };
    }

    const { content, reasoning } = await collectYuanbaoResponse(upstreamResponse.body, signal);
    const completionTokens = estimateTokens(content + reasoning);
    const messagePayload: Record<string, unknown> = { role: "assistant", content };
    if (reasoning) messagePayload.reasoning_content = reasoning;

    return {
      response: new Response(JSON.stringify({
        id, object: "chat.completion", created, model: resolvedModel,
        choices: [{ index: 0, message: messagePayload, finish_reason: "stop" }],
        usage: { prompt_tokens: estimateTokens(prompt), completion_tokens: completionTokens, total_tokens: estimateTokens(prompt) + completionTokens },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      url: messageUrl, headers: chatHeaders, transformedBody: chatBody,
    };
  }
}

export default YuanbaoWebExecutor;
