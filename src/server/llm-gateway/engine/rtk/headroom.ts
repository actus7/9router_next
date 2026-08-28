import { claudeToOpenAIRequest } from "../translator/request/claude-to-openai";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../translator/request/openai-responses";

const DEFAULT_TIMEOUT_MS = 3000;

interface HeadroomMessage {
  role: string;
  content: string | unknown[];
  [key: string]: unknown;
}

interface HeadroomTarget {
  object: Record<string, unknown>;
  key: string;
}

interface HeadroomProjection {
  messages: HeadroomMessage[];
  targets: HeadroomTarget[];
}

interface SizeSnapshot {
  bodyBytes: number;
  messageBytes: number;
  toolSchemaBytes: number;
  toolHistoryBytes: number;
}

interface HeadroomDiagnostics {
  reason?: string;
  endpoint?: string;
  before?: SizeSnapshot;
  after?: SizeSnapshot;
  [key: string]: unknown;
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) || "").length;
  } catch {
    return 0;
  }
}

function messagePayload(body: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(body?.messages)) return body.messages as unknown[];
  if (Array.isArray(body?.input)) return body.input as unknown[];
  const kiro = collectKiroHeadroomMessages(body);
  if (kiro) return kiro.messages;
  return null;
}

function captureSizeSnapshot(body: Record<string, unknown>): SizeSnapshot {
  const messages = messagePayload(body);
  const toolHistory = messages?.filter((message: unknown) => {
    const m = message as Record<string, unknown>;
    return m?.role === "tool"
      || m?.role === "function"
      || (m?.tool_calls as unknown[])?.length
      || (m?.content as unknown[])?.some?.((part: unknown) => {
        const p = part as Record<string, unknown>;
        return p?.type === "tool_use" || p?.type === "tool_result";
      });
  }) || [];
  return {
    bodyBytes: jsonBytes(body),
    messageBytes: messages ? jsonBytes(messages) : 0,
    toolSchemaBytes: jsonBytes((body as Record<string, unknown>)?.tools || []),
    toolHistoryBytes: jsonBytes(toolHistory),
  };
}

function setDiagnostic(diagnostics: HeadroomDiagnostics | null | undefined, reason: string) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = reason;
}

function scrubSensitiveUrlText(text: unknown): string {
  return String(text)
    .replace(/\/\/[^/@\s]+@/g, "//")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, "$1");
}

function describeFetchError(error: unknown): string {
  const err = error as Record<string, unknown> | undefined;
  const cause = err?.cause as Record<string, unknown> | undefined;
  const code = (cause?.code || err?.code) as string | undefined;
  const message = scrubSensitiveUrlText(cause?.message || err?.message || String(error));
  return code ? `${code}: ${message}` : message;
}

function buildCompressEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/v1/compress`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const raw = String(url).replace(/#.*$/, "");
    const [base, query = ""] = raw.split("?", 2);
    const endpoint = `${base.replace(/\/$/, "")}/v1/compress`;
    return query ? `${endpoint}?${query}` : endpoint;
  }
}

function maskEndpoint(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(endpoint).replace(/\/\/[^/@\s]+@/, "//").replace(/[?#].*$/, "");
  }
}

function hasUnsafeResponsesInputForCompression(body: Record<string, unknown>): boolean {
  if (!Array.isArray(body?.input)) return false;
  return (body.input as unknown[]).some((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return typeof (item as Record<string, unknown>).type === "string" && (item as Record<string, unknown>).type !== "message";
  });
}

function collectKiroHeadroomMessages(body: Record<string, unknown>): HeadroomProjection | null {
  const state = body?.conversationState as Record<string, unknown> | undefined;
  if (!state || typeof state !== "object") return null;

  const messages: HeadroomMessage[] = [];
  const targets: HeadroomTarget[] = [];

  const addTextTarget = (role: string, text: unknown, target: HeadroomTarget, extra: Record<string, unknown> = {}) => {
    if (typeof text !== "string") return;
    messages.push({ role, content: text, ...extra });
    targets.push(target);
  };

  const toToolCalls = (toolUses: unknown) => {
    if (!Array.isArray(toolUses) || toolUses.length === 0) return undefined;
    const calls = toolUses.map((toolUse: unknown) => {
      const tu = toolUse as Record<string, unknown>;
      return {
        id: tu?.toolUseId as string,
        type: "function",
        function: {
          name: (tu?.name as string) || "",
          arguments: JSON.stringify(tu?.input || {}),
        },
      };
    }).filter((call) => call.id || call.function.name);
    return calls.length > 0 ? calls : undefined;
  };

  const visit = (item: unknown) => {
    const it = item as Record<string, unknown>;
    const user = it?.userInputMessage as Record<string, unknown> | undefined;
    if (user) {
      addTextTarget("system", user.systemInstruction, { object: user, key: "systemInstruction" });
      addTextTarget("user", user.content, { object: user, key: "content" });

      const toolResults = (user.userInputMessageContext as Record<string, unknown>)?.toolResults as unknown[] | undefined;
      if (Array.isArray(toolResults)) {
        for (const toolResult of toolResults) {
          const tr = toolResult as Record<string, unknown>;
          const content = tr?.content;
          if (!Array.isArray(content)) continue;
          for (const part of content) {
            const p = part as Record<string, unknown>;
            addTextTarget(
              "tool",
              p?.text,
              { object: p, key: "text" },
              tr?.toolUseId ? { tool_call_id: tr.toolUseId } : {}
            );
          }
        }
      }
      return;
    }

    const assistant = it?.assistantResponseMessage as Record<string, unknown> | undefined;
    if (assistant) {
      const toolCalls = toToolCalls(assistant.toolUses);
      addTextTarget(
        "assistant",
        assistant.content,
        { object: assistant, key: "content" },
        toolCalls ? { tool_calls: toolCalls } : {}
      );
    }
  };

  if (Array.isArray(state.history)) {
    for (const item of state.history) visit(item);
  }
  if (state.currentMessage) visit(state.currentMessage);

  return messages.length > 0 ? { messages, targets } : null;
}

function textFromHeadroomMessage(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const content = m?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
    } else if (typeof (part as Record<string, unknown>)?.text === "string") {
      parts.push((part as Record<string, unknown>).text as string);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function applyKiroHeadroomMessages(projection: HeadroomProjection, compressedMessages: unknown[], diagnostics: HeadroomDiagnostics | null): boolean {
  if (!Array.isArray(compressedMessages) || compressedMessages.length !== projection.messages.length) {
    setDiagnostic(diagnostics, "proxy response did not match Kiro message count");
    return false;
  }

  const updates: Array<{ target: HeadroomTarget; text: string }> = [];
  for (let i = 0; i < projection.messages.length; i++) {
    const expected = projection.messages[i];
    const actual = compressedMessages[i] as Record<string, unknown>;
    if (!actual || actual.role !== expected.role) {
      setDiagnostic(diagnostics, "proxy response did not preserve Kiro message order");
      return false;
    }

    const text = textFromHeadroomMessage(actual);
    if (text === null) {
      setDiagnostic(diagnostics, "proxy response missing Kiro text content");
      return false;
    }
    updates.push({ target: projection.targets[i], text });
  }

  for (const update of updates) {
    update.target.object[update.target.key] = update.text;
  }
  return true;
}

// POST messages to Headroom /v1/compress; returns compressed messages + stats or null.
async function callCompress(url: string, messages: unknown[], model: string, timeoutMs: number, compressUserMessages: boolean | undefined, diagnostics: HeadroomDiagnostics): Promise<Record<string, unknown> | null> {
  const endpoint = buildCompressEndpoint(url);
  diagnostics.endpoint = maskEndpoint(endpoint);
  const payload: Record<string, unknown> = { messages, model };
  if (compressUserMessages) payload.config = { compress_user_messages: true };
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    setDiagnostic(diagnostics, `request failed: ${describeFetchError(error)}`);
    return null;
  }
  if (!res.ok) {
    setDiagnostic(diagnostics, `proxy returned HTTP ${res.status}`);
    return null;
  }
  const data = await res.json() as Record<string, unknown>;
  if (!Array.isArray(data?.messages)) {
    setDiagnostic(diagnostics, "proxy response missing messages[]");
    return null;
  }
  return data;
}

// Compress request body via Headroom proxy. Fail-open: returns null on any error.
// /v1/compress only understands OpenAI shape, so Claude bodies are translated
// to OpenAI, compressed, then translated back using 9Router's own translators.
export async function compressWithHeadroom(body: Record<string, unknown>, { enabled, url, model, format, compressUserMessages, timeoutMs = DEFAULT_TIMEOUT_MS, diagnostics = null }: { enabled?: boolean; url?: string; model?: string; format?: string; compressUserMessages?: boolean; timeoutMs?: number; diagnostics?: HeadroomDiagnostics | null } = {}) {
  if (!enabled) {
    setDiagnostic(diagnostics, "disabled");
    return null;
  }
  if (!url) {
    setDiagnostic(diagnostics, "missing proxy URL");
    return null;
  }
  if (!body) {
    setDiagnostic(diagnostics, "missing request body");
    return null;
  }

  try {
    if (diagnostics) diagnostics.before = captureSizeSnapshot(body);

    // Claude shape: translate → OpenAI → compress → translate back.
    if (format === "claude") {
      const oai = claudeToOpenAIRequest(model!, body, false) as Record<string, unknown>;
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "Claude request did not translate to messages[]");
        return null;
      }
      const data = await callCompress(url, oai.messages as unknown[], model!, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      const claudeBody = openaiToClaudeRequest(model!, { ...oai, messages: data.messages }, false) as Record<string, unknown>;
      if (Array.isArray(claudeBody?.messages)) body.messages = claudeBody.messages;
      if (claudeBody?.system !== undefined) body.system = claudeBody.system;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI Responses shape (Codex): body.input holds Responses items, NOT OpenAI
    // messages. Translate input -> OpenAI -> compress -> translate back to input so
    // body.input keeps the Responses contract (the proxy only understands OpenAI). (#1998)
    if (format === "openai-responses") {
      if (hasUnsafeResponsesInputForCompression(body)) {
        setDiagnostic(diagnostics, "skipped: openai-responses tool/reasoning input is not safe to compress");
        return null;
      }
      const oai = openaiResponsesToOpenAIRequest(model!, body, false, undefined as unknown as Record<string, unknown>) as Record<string, unknown>;
      if (!Array.isArray(oai?.messages)) return null;
      const data = await callCompress(url, oai.messages as unknown[], model!, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      // input: undefined so the translator rebuilds input from the compressed
      // messages instead of returning the original input unchanged.
      const responsesBody = openaiToOpenAIResponsesRequest(
        model!,
        { ...oai, input: undefined, messages: data.messages },
        false,
        undefined as unknown as Record<string, unknown>
      ) as Record<string, unknown>;
      if (Array.isArray(responsesBody?.input)) body.input = responsesBody.input;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // Kiro shape: conversationState.history/currentMessage are projected to
    // OpenAI messages for the proxy, then copied back into the original Kiro
    // fields. Keep the provider payload shape intact for Kiro's executor.
    if (format === "kiro") {
      const projection = collectKiroHeadroomMessages(body);
      if (!projection) {
        setDiagnostic(diagnostics, "Kiro request did not project to messages[]");
        return null;
      }
      const data = await callCompress(url, projection.messages, model!, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      if (!applyKiroHeadroomMessages(projection, data.messages as unknown[], diagnostics)) return null;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI shape: messages/input go straight to the proxy.
    const key = Array.isArray(body.messages) ? "messages"
      : Array.isArray(body.input) ? "input"
      : null;
    if (!key) {
      setDiagnostic(diagnostics, `unsupported ${format || "unknown"} request shape`);
      return null;
    }
    const data = await callCompress(url, body[key] as unknown[], model!, timeoutMs, compressUserMessages, diagnostics || {});
    if (!data) return null;
    body[key] = data.messages;
    if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
    return data;
  } catch (error: unknown) {
    setDiagnostic(diagnostics, `unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function formatHeadroomLog(stats: Record<string, unknown> | null | undefined) {
  if (!stats) return null;
  const before = (stats.tokens_before as number) || 0;
  const after = (stats.tokens_after as number) || 0;
  const delta = (stats.tokens_saved as number) || 0;
  const pct = before > 0 ? ((delta / before) * 100).toFixed(1) : "0";
  return `reported token delta=${delta} before=${before}${after ? ` after=${after}` : ""} (${pct}%)`.trim();
}

export function formatHeadroomSizeLog(diagnostics: HeadroomDiagnostics | null | undefined) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after) return "";
  const effective = before.bodyBytes > 0
    ? (((before.bodyBytes - after.bodyBytes) / before.bodyBytes) * 100).toFixed(1)
    : "0.0";
  return `body=${before.bodyBytes}B→${after.bodyBytes}B messages=${before.messageBytes}B→${after.messageBytes}B tools=${before.toolSchemaBytes || 0}B→${after.toolSchemaBytes || 0}B toolHistory=${before.toolHistoryBytes || 0}B→${after.toolHistoryBytes || 0}B effective=${effective}%`;
}

export function isHeadroomPhantomSavings(stats: Record<string, unknown> | null | undefined, diagnostics: HeadroomDiagnostics | null | undefined, minShrinkRatio = 0.05) {
  if (!stats?.tokens_saved || (stats.tokens_saved as number) <= 0) return false;
  const before = diagnostics?.before?.bodyBytes || 0;
  const after = diagnostics?.after?.bodyBytes || 0;
  if (before <= 0 || after <= 0) return false;
  return after >= before * (1 - minShrinkRatio);
}
