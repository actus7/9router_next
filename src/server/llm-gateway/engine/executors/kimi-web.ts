// Kimi Web (www.kimi.ai international consumer chat) executor.
//
// The domain migrated from kimi.moonshot.cn to www.kimi.ai, which speaks a
// completely different protocol than plain OpenAI-shaped SSE:
//   - Endpoint: POST /apiv2/kimi.gateway.chat.v1.ChatService/Chat
//   - Protocol: Connect-RPC — each message is wrapped in a 5-byte envelope
//     (1 flags byte + 4 big-endian length bytes) followed by JSON.
//   - Body: protobuf-shaped ChatRequest JSON (chat_id/scenario/message.blocks),
//     NOT {messages, model, stream}.
// The previous version of this executor sent an OpenAI-shaped JSON body and
// parsed the response as `data:` SSE lines — against a Connect-framed binary
// stream that never produces a usable response. Ported from OmniRoute's
// kimi-web.ts (auto-refresh-on-401 was left out; it depends on a separate
// refresh-token exchange service this project doesn't have yet).
import { BaseExecutor } from "./base";
import type { Credentials, Logger } from "../services/types";

const BASE_URL = "https://www.kimi.ai";
const CHAT_URL = `${BASE_URL}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const MAX_FRAME_LEN = 8 * 1024 * 1024;

interface KimiModelConfig {
  scenario: string;
  kimiPlusId?: string;
}

const MODEL_CONFIGS: Record<string, KimiModelConfig> = {
  k3: { scenario: "SCENARIO_K2D5" },
  k2d6: { scenario: "SCENARIO_K2D5" },
};

function extractKimiAccessToken(rawValue: string): string {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";

  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const access = parsed?.access_token ?? parsed?.token;
      if (typeof access === "string" && access) return access.trim();
    } catch { /* not JSON */ }
  }

  const bearer = raw.match(/^(?:authorization:\s*)?bearer\s+([^;\s]+)/i);
  if (bearer) return bearer[1];

  const trimmed = raw.replace(/^bearer\s+/i, "").replace(/^cookie:/i, "").trim();
  for (const key of ["access_token", "kimi-auth"]) {
    const match = trimmed.match(new RegExp(`(?:^|[\\s;])${key}=([^;\\s]+)`));
    if (match) return match[1];
  }

  return !trimmed.includes("=") && !trimmed.includes(";") ? trimmed : "";
}

/** Wrap a JSON message in the 5-byte Connect streaming envelope (flags + length). */
function frameConnectMessage(json: string): Uint8Array {
  const payload = new TextEncoder().encode(json);
  const framed = new Uint8Array(5 + payload.length);
  framed[0] = 0; // flags: 0 = uncompressed
  const len = payload.length;
  framed[1] = (len >>> 24) & 0xff;
  framed[2] = (len >>> 16) & 0xff;
  framed[3] = (len >>> 8) & 0xff;
  framed[4] = len & 0xff;
  framed.set(payload, 5);
  return framed;
}

interface ConnectFrame {
  flags: number;
  message: Record<string, unknown> | null;
}

/** Decode one Connect frame from a stream buffer. consumed=0 → need more bytes,
 * consumed=-1 → declared length exceeds MAX_FRAME_LEN (protocol error). */
function decodeConnectFrame(buf: Uint8Array, byteOffset: number): { consumed: number; frame: ConnectFrame | null } {
  if (byteOffset + 5 > buf.length) return { consumed: 0, frame: null };
  const flags = buf[byteOffset];
  const len = (buf[byteOffset + 1] << 24) | (buf[byteOffset + 2] << 16) | (buf[byteOffset + 3] << 8) | buf[byteOffset + 4];
  const msgLen = len < 0 ? len + 0x100000000 : len;
  if (msgLen > MAX_FRAME_LEN) return { consumed: -1, frame: null };
  if (byteOffset + 5 + msgLen > buf.length) return { consumed: 0, frame: null };
  if ((flags & ~0x03) !== 0) throw new Error(`Kimi Connect frame used unsupported flags: ${flags}`);
  if ((flags & 0x01) !== 0) throw new Error("Kimi Connect compressed frames are not supported");

  const payload = buf.subarray(byteOffset + 5, byteOffset + 5 + msgLen);
  let message: Record<string, unknown> | null = null;
  if (msgLen > 0) {
    try {
      message = JSON.parse(new TextDecoder().decode(payload));
    } catch (error) {
      throw new Error(`Kimi Connect frame contained invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`);
    }
  }
  return { consumed: 5 + msgLen, frame: { flags, message } };
}

function getConnectEndStreamError(frame: ConnectFrame): string | null {
  if ((frame.flags & 0x02) === 0) return null;
  const error = frame.message?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "unknown";
  const message = typeof record.message === "string" ? record.message : "upstream error";
  return `${code}: ${message}`;
}

type DeltaKind = "text" | "think" | null;

/** op:"set" (first chunk) / op:"append" (subsequent) against block.text(.content)
 * or block.think(.content) masks — everything else (heartbeats, metadata) is dropped. */
function extractDelta(msg: Record<string, unknown> | null): { kind: DeltaKind; text: string } | null {
  if (!msg) return null;
  const op = String(msg.op ?? "");
  const mask = String(msg.mask ?? "");
  const block = (msg.block ?? {}) as Record<string, unknown>;

  const readBlock = (key: "text" | "think") => String(((block[key] ?? {}) as Record<string, unknown>).content ?? "");

  if (op === "append") {
    if (mask === "block.text.content") { const t = readBlock("text"); return t ? { kind: "text", text: t } : null; }
    if (mask === "block.think.content") { const t = readBlock("think"); return t ? { kind: "think", text: t } : null; }
    return null;
  }
  if (op === "set") {
    if (mask === "block.text") { const t = readBlock("text"); return t ? { kind: "text", text: t } : null; }
    if (mask === "block.think") { const t = readBlock("think"); return t ? { kind: "think", text: t } : null; }
  }
  return null;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Kimi Web only supports text message content");
  return content.map((part) => {
    const record = part as Record<string, unknown>;
    if (record && (record.type === "text" || record.type === "input_text") && typeof record.text === "string") return record.text;
    throw new Error("Kimi Web does not support image, audio, file, or tool content");
  }).join("");
}

/** Fold text-only OpenAI history into the single user turn Kimi Web accepts. */
function foldMessages(messages: Array<{ role: string; content: unknown; tool_calls?: unknown }>): { prompt: string; systemPrompt: string } {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];
  for (const message of messages) {
    if (message.role === "tool" || message.role === "function") throw new Error("Kimi Web does not support tool result messages");
    if (message.tool_calls !== undefined) throw new Error("Kimi Web does not support assistant tool calls");
    const text = textFromContent(message.content);
    if (message.role === "system" || message.role === "developer") { if (text) systemParts.push(text); }
    else if (message.role === "user") { if (text) conversationParts.push(conversationParts.length > 0 ? `User: ${text}` : text); }
    else if (message.role === "assistant") { if (text) conversationParts.push(`Assistant: ${text}`); }
    else throw new Error(`Kimi Web does not support message role ${message.role}`);
  }
  return { prompt: conversationParts.join("\n\n").trim(), systemPrompt: systemParts.join("\n\n").trim() };
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), { status, headers: { "Content-Type": "application/json" } });
}

function buildKimiHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/connect+json",
    Accept: "*/*",
    "User-Agent": USER_AGENT,
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    "connect-protocol-version": "1",
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  return headers;
}

function buildRequestBody(messages: { prompt: string; systemPrompt: string }, config: KimiModelConfig): string {
  const options: Record<string, unknown> = {
    thinking: true,
    enable_plugin: false,
    ...(messages.systemPrompt ? { system_prompt: messages.systemPrompt } : {}),
  };
  return JSON.stringify({
    chat_id: "",
    ...(config.kimiPlusId ? { kimiplus_id: config.kimiPlusId } : {}),
    scenario: config.scenario,
    tools: [],
    message: {
      id: "", parent_id: "", children_message_ids: [], role: "user",
      blocks: [{ id: "", message_id: "", text: { content: messages.prompt } }],
      scenario: config.scenario, labels: [], references: [], is_goal: false,
    },
    options,
    project_id: "",
  });
}

export class KimiWebExecutor extends BaseExecutor {
  constructor() {
    super("kimi-web", { baseUrl: CHAT_URL });
  }

  async execute({ model, body, stream: wantStream, credentials, signal, log }: {
    model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger;
  }) {
    const accessToken = extractKimiAccessToken(String(credentials.accessToken ?? credentials.apiKey ?? ""));
    if (!accessToken) {
      return { response: errorResponse(400, "Missing Kimi access_token — log in at www.kimi.ai and capture access_token from Local Storage."), url: CHAT_URL, headers: {}, transformedBody: body };
    }

    const modelId = model || String(body.model || "");
    const modelConfig = MODEL_CONFIGS[modelId];
    if (!modelConfig) {
      return { response: errorResponse(400, `Unsupported Kimi Web model: ${modelId}`), url: CHAT_URL, headers: {}, transformedBody: body };
    }

    if (Array.isArray(body.tools) && body.tools.length > 0) {
      return { response: errorResponse(400, "Kimi Web does not support OpenAI function tools"), url: CHAT_URL, headers: {}, transformedBody: body };
    }

    let folded: { prompt: string; systemPrompt: string };
    try {
      const messages = Array.isArray(body.messages) ? (body.messages as Array<{ role: string; content: unknown; tool_calls?: unknown }>) : [];
      folded = foldMessages(messages);
      if (!folded.prompt) throw new Error("Kimi Web requires a non-empty user message");
    } catch (err) {
      return { response: errorResponse(400, err instanceof Error ? err.message : "Invalid Kimi Web request"), url: CHAT_URL, headers: {}, transformedBody: body };
    }

    const reqBody = buildRequestBody(folded, modelConfig);
    const reqHeaders = buildKimiHeaders(accessToken);
    const framedBody = frameConnectMessage(reqBody);

    log?.info?.("KIMI-WEB", `Query to ${modelId}, scenario=${modelConfig.scenario}`);

    let upstream: Response;
    try {
      upstream = await fetch(CHAT_URL, { method: "POST", headers: reqHeaders, body: new Uint8Array(framedBody), signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("KIMI-WEB", `Fetch failed: ${msg}`);
      return { response: errorResponse(502, `Kimi fetch failed: ${msg}`), url: CHAT_URL, headers: reqHeaders, transformedBody: JSON.parse(reqBody) };
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      let errMsg = errText || `Kimi returned HTTP ${upstream.status}`;
      if (upstream.status === 401 || upstream.status === 403) errMsg = "Kimi auth failed — access_token may be expired. Re-paste from Local Storage of www.kimi.ai.";
      log?.warn?.("KIMI-WEB", errMsg);
      return { response: errorResponse(upstream.status, errMsg), url: CHAT_URL, headers: reqHeaders, transformedBody: JSON.parse(reqBody) };
    }

    const encoder = new TextEncoder();
    const id = `chatcmpl-kimi-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const sourceStream = upstream.body ?? new ReadableStream({ start: (c) => c.close() });

    const emitChunk = (controller: ReadableStreamDefaultController, delta: Record<string, unknown>, finish: string | null = null) => {
      const chunk = { id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: finish }] };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    };

    if (wantStream) {
      const outStream = new ReadableStream({
        async start(controller) {
          const reader = sourceStream.getReader();
          let buffer = new Uint8Array(0);
          let emittedRole = false;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value) continue;
              const merged = new Uint8Array(buffer.length + value.length);
              merged.set(buffer, 0);
              merged.set(value, buffer.length);
              buffer = merged;

              let offset = 0;
              while (offset < buffer.length) {
                const { consumed, frame } = decodeConnectFrame(buffer, offset);
                if (consumed === -1) throw new Error("Kimi Connect frame exceeded MAX_FRAME_LEN");
                if (consumed === 0) break;
                offset += consumed;
                if (!frame) continue;
                if ((frame.flags & 0x02) !== 0) {
                  const endStreamError = getConnectEndStreamError(frame);
                  if (endStreamError) throw new Error(`Kimi Connect EndStream error: ${endStreamError}`);
                  if (!emittedRole) emitChunk(controller, { role: "assistant", content: "" });
                  emitChunk(controller, {}, "stop");
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                  return;
                }
                if (!frame.message) continue;
                const delta = extractDelta(frame.message);
                if (delta) {
                  if (!emittedRole) { emittedRole = true; emitChunk(controller, { role: "assistant", content: "" }); }
                  emitChunk(controller, delta.kind === "think" ? { reasoning_content: delta.text } : { content: delta.text });
                }
              }
              buffer = buffer.subarray(offset);
            }
            throw new Error("Kimi Connect stream ended without a successful EndStream frame");
          } catch (err) {
            if (signal?.aborted) { try { controller.close(); } catch { /* already closed */ } }
            else { try { controller.error(err); } catch { /* already closed */ } }
          }
        },
      });
      return {
        response: new Response(outStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: CHAT_URL, headers: reqHeaders, transformedBody: JSON.parse(reqBody),
      };
    }

    let answer = "";
    let reasoning = "";
    const reader = sourceStream.getReader();
    let buffer = new Uint8Array(0);
    let sawSuccessfulEndStream = false;
    try {
      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0);
        merged.set(value, buffer.length);
        buffer = merged;

        let offset = 0;
        while (offset < buffer.length) {
          const { consumed, frame } = decodeConnectFrame(buffer, offset);
          if (consumed === -1) throw new Error("Kimi Connect frame exceeded MAX_FRAME_LEN");
          if (consumed === 0) break;
          offset += consumed;
          if (!frame) continue;
          if ((frame.flags & 0x02) !== 0) {
            const endStreamError = getConnectEndStreamError(frame);
            if (endStreamError) throw new Error(`Kimi Connect EndStream error: ${endStreamError}`);
            sawSuccessfulEndStream = true;
            break readLoop;
          }
          if (!frame.message) continue;
          const delta = extractDelta(frame.message);
          if (delta) { if (delta.kind === "think") reasoning += delta.text; else answer += delta.text; }
        }
        buffer = buffer.subarray(offset);
      }
      if (!sawSuccessfulEndStream) throw new Error("Kimi Connect stream ended without a successful EndStream frame");
    } catch (err) {
      return { response: errorResponse(502, `Kimi Connect protocol error: ${err instanceof Error ? err.message : "unknown"}`), url: CHAT_URL, headers: reqHeaders, transformedBody: JSON.parse(reqBody) };
    }

    const message: Record<string, unknown> = { role: "assistant", content: answer };
    if (reasoning) message.reasoning_content = reasoning;
    const completion = { id, object: "chat.completion", created, model: modelId, choices: [{ index: 0, message, finish_reason: "stop" }] };
    return {
      response: new Response(JSON.stringify(completion), { headers: { "Content-Type": "application/json" } }),
      url: CHAT_URL, headers: reqHeaders, transformedBody: JSON.parse(reqBody),
    };
  }
}

export default KimiWebExecutor;
