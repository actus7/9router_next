import type { ToolCall } from "../types";
import type { NormalizedModel } from "../types";

const MAX_RESULT_CHARS = 30_000;

async function resolveWebProvider(kind: "webSearch" | "webFetch", apiKey: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch("/api/v1/models/web", {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as { data?: Array<{ kind?: unknown; owned_by?: unknown; id?: unknown }> } | null;
  const model = payload?.data?.find((entry) => entry.kind === kind);
  if (!model) return null;
  if (typeof model.owned_by === "string" && model.owned_by) return model.owned_by;
  return typeof model.id === "string" ? model.id.replace(/\/search$/, "") : null;
}

interface RuntimeToolContext {
  apiKey: string;
  model: NormalizedModel;
  signal: AbortSignal;
}

export async function executeRuntimeToolCall(call: ToolCall, context: RuntimeToolContext): Promise<string> {
  const { apiKey, model, signal } = context;
  if (call.name !== "web_search" && call.name !== "web_fetch" && call.name !== "delegate_task") {
    return JSON.stringify({ ok: false, error: `Unsupported runtime tool: ${call.name}` });
  }

  let arguments_: { query?: unknown; max_results?: unknown; task?: unknown; url?: unknown; max_characters?: unknown };
  try {
    const parsed = JSON.parse(call.arguments);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be an object");
    arguments_ = parsed;
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Invalid tool arguments" });
  }
  if (call.name === "delegate_task") {
    if (typeof arguments_.task !== "string" || !arguments_.task.trim()) {
      return JSON.stringify({ ok: false, error: "delegate_task requires a non-empty task" });
    }
    const response = await fetch("/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: model.requestModel || model.id,
        stream: false,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are an ephemeral subagent. Complete only the delegated task. Be concise and return findings to the parent agent. Do not call tools, do not delegate, and do not claim actions you did not perform." },
          { role: "user", content: arguments_.task.trim().slice(0, 12_000) },
        ],
      }),
      signal,
    });
    const text = await response.text();
    if (!response.ok) return JSON.stringify({ ok: false, status: response.status, error: text.slice(0, MAX_RESULT_CHARS) });
    try {
      const payload = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload.choices?.[0]?.message?.content;
      return JSON.stringify({ ok: true, result: typeof content === "string" ? content : text.slice(0, MAX_RESULT_CHARS) });
    } catch {
      return JSON.stringify({ ok: true, result: text.slice(0, MAX_RESULT_CHARS) });
    }
  }

  if (call.name === "web_fetch") {
    if (typeof arguments_.url !== "string" || !arguments_.url.trim()) {
      return JSON.stringify({ ok: false, error: "web_fetch requires a public URL" });
    }
    const provider = await resolveWebProvider("webFetch", apiKey, signal);
    if (!provider) return JSON.stringify({ ok: false, error: "No configured web fetch provider is available" });
    const response = await fetch("/api/v1/web/fetch", {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        provider,
        url: arguments_.url.trim(),
        ...(typeof arguments_.max_characters === "number" ? { max_characters: Math.max(500, Math.min(MAX_RESULT_CHARS, Math.floor(arguments_.max_characters))) } : {}),
      }),
      signal,
    });
    const text = await response.text();
    if (!response.ok) return JSON.stringify({ ok: false, status: response.status, error: text.slice(0, MAX_RESULT_CHARS) });
    return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : text;
  }

  if (typeof arguments_.query !== "string" || !arguments_.query.trim()) {
    return JSON.stringify({ ok: false, error: "web_search requires a non-empty query" });
  }

  const provider = await resolveWebProvider("webSearch", apiKey, signal);
  if (!provider) return JSON.stringify({ ok: false, error: "No configured web search provider is available" });

  const response = await fetch("/api/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      query: arguments_.query.trim(),
      provider,
      ...(typeof arguments_.max_results === "number" ? { max_results: Math.max(1, Math.min(10, Math.floor(arguments_.max_results))) } : {}),
    }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) return JSON.stringify({ ok: false, status: response.status, error: text.slice(0, MAX_RESULT_CHARS) });
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : text;
}
