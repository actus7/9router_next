import type { ToolCall } from "../types";
import type { NormalizedModel } from "../types";

const MAX_RESULT_CHARS = 30_000;

interface WebProviderEntry {
  kind?: unknown;
  owned_by?: unknown;
  id?: unknown;
}

function extractProvider(entry: WebProviderEntry): string | null {
  if (entry.owned_by !== "combo" && typeof entry.owned_by === "string" && entry.owned_by) {
    return entry.owned_by;
  }
  if (typeof entry.id === "string") return entry.id.replace(/\/(search|fetch)$/, "");
  return null;
}

/**
 * Returns deduplicated provider list for the requested kind, preserving
 * first-occurrence order from the API response. Only exact kind matches
 * are considered (no fallback to `kind: smart`).
 */
async function resolveWebProviders(kind: "webSearch" | "webFetch", apiKey: string, signal: AbortSignal): Promise<string[]> {
  const response = await fetch("/api/v1/models/web", {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as { data?: WebProviderEntry[] } | null;
  const entries = payload?.data;
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const providers: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== kind) continue;
    const provider = extractProvider(entry);
    if (provider && !seen.has(provider)) {
      seen.add(provider);
      providers.push(provider);
    }
  }
  return providers;
}

interface RuntimeToolContext {
  apiKey: string;
  model: NormalizedModel;
  signal: AbortSignal;
}

interface AttemptInfo {
  provider: string;
  status: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Tries providers sequentially for a search/fetch call.
 * Returns the successful response text, or throws on AbortError.
 * If all providers fail, returns a JSON error with attempt details.
 */
async function tryProvidersWithFallback(
  providers: string[],
  kind: "webSearch" | "webFetch",
  buildRequest: (provider: string) => { url: string; init: RequestInit },
  signal: AbortSignal,
): Promise<string> {
  const attempts: AttemptInfo[] = [];

  for (const provider of providers) {
    const { url, init } = buildRequest(provider);
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      // Abort/cancellation must propagate immediately — no fallback
      if (isAbortError(error) || signal.aborted) throw error;
      attempts.push({ provider, status: 0 });
      continue;
    }

    const text = await response.text();
    if (response.ok) {
      return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : text;
    }
    attempts.push({ provider, status: response.status });
  }

  const lastStatus = attempts.length > 0 ? attempts[attempts.length - 1]!.status : undefined;
  return JSON.stringify({
    ok: false,
    error: `All providers failed for ${kind === "webSearch" ? "web search" : "web fetch"}`,
    status: lastStatus,
    attempts,
  });
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
    const providers = await resolveWebProviders("webFetch", apiKey, signal);
    if (providers.length === 0) return JSON.stringify({ ok: false, error: "No configured web fetch provider is available" });

    return tryProvidersWithFallback(
      providers,
      "webFetch",
      (provider) => ({
        url: "/api/v1/web/fetch",
        init: {
          method: "POST",
          headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            provider,
            url: arguments_.url!.toString().trim(),
            ...(typeof arguments_.max_characters === "number" ? { max_characters: Math.max(500, Math.min(MAX_RESULT_CHARS, Math.floor(arguments_.max_characters as number))) } : {}),
          }),
        },
      }),
      signal,
    );
  }

  if (typeof arguments_.query !== "string" || !arguments_.query.trim()) {
    return JSON.stringify({ ok: false, error: "web_search requires a non-empty query" });
  }

  const providers = await resolveWebProviders("webSearch", apiKey, signal);
  if (providers.length === 0) return JSON.stringify({ ok: false, error: "No configured web search provider is available" });

  return tryProvidersWithFallback(
    providers,
    "webSearch",
    (provider) => ({
      url: "/api/v1/search",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          query: arguments_.query!.toString().trim(),
          provider,
          ...(typeof arguments_.max_results === "number" ? { max_results: Math.max(1, Math.min(10, Math.floor(arguments_.max_results as number))) } : {}),
        }),
      },
    }),
    signal,
  );
}
