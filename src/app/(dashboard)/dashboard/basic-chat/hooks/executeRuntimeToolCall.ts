import type { HarnessMcpServer, NormalizedModel, ToolCall } from "../types";

const MAX_RESULT_CHARS = 30_000;
const MAX_AUDIO_BYTES = 10_000_000;
const VIDEO_POLL_TIMEOUT_MS = 90_000;
const VIDEO_POLL_INTERVAL_MS = 3_000;

interface WebProviderEntry {
  kind?: unknown;
  owned_by?: unknown;
  id?: unknown;
}

function extractProvider(entry: WebProviderEntry): string | null {
  if (
    entry.owned_by !== "combo" &&
    typeof entry.owned_by === "string" &&
    entry.owned_by
  ) {
    return entry.owned_by;
  }
  if (typeof entry.id === "string")
    return entry.id.replace(/\/(search|fetch)$/, "");
  return null;
}

/**
 * Returns deduplicated provider list for the requested kind, preserving
 * first-occurrence order from the API response. Only exact kind matches
 * are considered (no fallback to `kind: smart`).
 */
async function resolveWebProviders(
  kind: "webSearch" | "webFetch",
  apiKey: string,
  signal: AbortSignal,
): Promise<string[]> {
  const response = await fetch("/api/v1/models/web", {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as {
    data?: WebProviderEntry[];
  } | null;
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

/**
 * Returns deduplicated `provider/model` ids for a media kind (image, tts, video)
 * from the generic `/api/v1/models/{kind}` listing, preserving response order.
 */
async function resolveMediaModels(
  kind: "image" | "tts" | "video",
  apiKey: string,
  signal: AbortSignal,
): Promise<string[]> {
  const response = await fetch(`/api/v1/models/${kind}`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ id?: unknown }>;
  } | null;
  const entries = payload?.data;
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const models: string[] = [];
  for (const entry of entries) {
    if (typeof entry.id === "string" && entry.id && !seen.has(entry.id)) {
      seen.add(entry.id);
      models.push(entry.id);
    }
  }
  return models;
}

interface RuntimeToolContext {
  apiKey: string;
  model: NormalizedModel;
  signal: AbortSignal;
  enabledToolNames?: ReadonlySet<string>;
  mcpServers?: readonly HarnessMcpServer[];
  sessionId?: string;
  webSearchMaxResults?: number;
  webFetchMaxCharacters?: number;
}

interface AttemptInfo {
  provider: string;
  status: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      },
      { once: true },
    );
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Tries providers/models sequentially for a call whose success response is text/JSON.
 * Returns the successful response text, or throws on AbortError.
 * If all attempts fail, returns a JSON error with attempt details.
 */
async function tryProvidersWithFallback(
  providers: string[],
  label: string,
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
      return text.length > MAX_RESULT_CHARS
        ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]`
        : text;
    }
    attempts.push({ provider, status: response.status });
  }

  const lastStatus =
    attempts.length > 0 ? attempts[attempts.length - 1]!.status : undefined;
  return JSON.stringify({
    ok: false,
    error: `All providers failed for ${label}`,
    status: lastStatus,
    attempts,
  });
}

/**
 * Tries models sequentially for a call whose success response is binary audio.
 * Returns a JSON string with a `data:` URI on success, or an aggregated error.
 */
async function tryModelsForAudio(
  models: string[],
  buildRequest: (model: string) => { url: string; init: RequestInit },
  signal: AbortSignal,
): Promise<string> {
  const attempts: AttemptInfo[] = [];

  for (const model of models) {
    const { url, init } = buildRequest(model);
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error;
      attempts.push({ provider: model, status: 0 });
      continue;
    }

    if (response.ok) {
      const buf = await response.arrayBuffer();
      if (buf.byteLength > MAX_AUDIO_BYTES) {
        return JSON.stringify({
          ok: false,
          error: "Generated audio exceeds the size limit",
        });
      }
      const contentType = response.headers.get("content-type") || "audio/mpeg";
      return JSON.stringify({
        ok: true,
        audioUrl: `data:${contentType};base64,${arrayBufferToBase64(buf)}`,
      });
    }
    attempts.push({ provider: model, status: response.status });
  }

  const lastStatus =
    attempts.length > 0 ? attempts[attempts.length - 1]!.status : undefined;
  return JSON.stringify({
    ok: false,
    error: "All providers failed for text to speech",
    status: lastStatus,
    attempts,
  });
}

interface VideoPollResult {
  ok: boolean;
  url?: string;
  error?: string;
  requestId?: string;
}

/** Polls a created video job until it completes, fails, or the timeout elapses. */
async function pollVideoJob(
  requestId: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<VideoPollResult> {
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(
      `/api/v1/videos/${encodeURIComponent(requestId)}`,
      {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal,
      },
    );
    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        video?: { url?: string };
        error?: unknown;
      } | null;
      if (
        payload?.status === "completed" &&
        typeof payload.video?.url === "string"
      ) {
        return { ok: true, url: payload.video.url };
      }
      if (payload?.status === "failed") {
        return {
          ok: false,
          error:
            typeof payload.error === "string"
              ? payload.error
              : "Video generation failed",
          requestId,
        };
      }
    }
    await sleep(VIDEO_POLL_INTERVAL_MS, signal);
  }
  return { ok: false, error: "Video generation timed out", requestId };
}

/** Creates a video generation job, trying each candidate model in order, then polls it to completion. */
async function generateVideo(
  models: string[],
  prompt: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  const attempts: AttemptInfo[] = [];

  for (const model of models) {
    let response: Response;
    try {
      response = await fetch("/api/v1/videos/generations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, prompt }),
        signal,
      });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error;
      attempts.push({ provider: model, status: 0 });
      continue;
    }

    if (!response.ok) {
      attempts.push({ provider: model, status: response.status });
      continue;
    }
    const payload = (await response.json().catch(() => null)) as {
      request_id?: unknown;
    } | null;
    if (typeof payload?.request_id !== "string" || !payload.request_id) {
      attempts.push({ provider: model, status: response.status });
      continue;
    }
    const polled = await pollVideoJob(payload.request_id, apiKey, signal);
    return JSON.stringify(polled);
  }

  const lastStatus =
    attempts.length > 0 ? attempts[attempts.length - 1]!.status : undefined;
  return JSON.stringify({
    ok: false,
    error: "All providers failed for video generation",
    status: lastStatus,
    attempts,
  });
}

export async function executeRuntimeToolCall(
  call: ToolCall,
  context: RuntimeToolContext,
): Promise<string> {
  const { apiKey, model, signal } = context;
  const supportedTools =
    context.enabledToolNames ??
    new Set([
      "web_search",
      "web_fetch",
      "delegate_task",
      "generate_image",
      "text_to_speech",
      "generate_video",
    ]);
  if (!supportedTools.has(call.name)) {
    return JSON.stringify({
      ok: false,
      error: `Unsupported runtime tool or disabled in this session: ${call.name}`,
    });
  }

  let arguments_: {
    query?: unknown;
    max_results?: unknown;
    task?: unknown;
    url?: unknown;
    max_characters?: unknown;
    prompt?: unknown;
    input?: unknown;
    voice?: unknown;
    model?: unknown;
  };
  try {
    const parsed = JSON.parse(call.arguments);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Tool arguments must be an object");
    arguments_ = parsed;
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid tool arguments",
    });
  }

  const mcpServer = context.mcpServers?.find(
    (server) =>
      server.enabled &&
      server.tools.some((tool) => tool.runtimeName === call.name),
  );
  if (mcpServer) {
    const response = await fetch("/api/harness/mcp/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: context.sessionId,
        serverId: mcpServer.id,
        runtimeName: call.name,
        arguments: arguments_,
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: unknown;
      error?: unknown;
    } | null;
    return JSON.stringify(
      payload?.ok
        ? { ok: true, result: payload.result }
        : {
            ok: false,
            error:
              typeof payload?.error === "string"
                ? payload.error
                : "Falha ao executar ferramenta MCP",
          },
    );
  }

  const requestedModel =
    typeof arguments_.model === "string" && arguments_.model.trim()
      ? arguments_.model.trim()
      : null;

  if (call.name === "generate_image") {
    if (typeof arguments_.prompt !== "string" || !arguments_.prompt.trim()) {
      return JSON.stringify({
        ok: false,
        error: "generate_image requires a non-empty prompt",
      });
    }
    const models = requestedModel
      ? [requestedModel]
      : await resolveMediaModels("image", apiKey, signal);
    if (models.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured image generation provider is available",
      });

    return tryProvidersWithFallback(
      models,
      "image generation",
      (m) => ({
        url: "/api/v1/images/generations",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model: m, prompt: arguments_.prompt }),
        },
      }),
      signal,
    );
  }

  if (call.name === "text_to_speech") {
    if (typeof arguments_.input !== "string" || !arguments_.input.trim()) {
      return JSON.stringify({
        ok: false,
        error: "text_to_speech requires non-empty input",
      });
    }
    const models = requestedModel
      ? [requestedModel]
      : await resolveMediaModels("tts", apiKey, signal);
    if (models.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured text-to-speech provider is available",
      });

    return tryModelsForAudio(
      models,
      (m) => ({
        url: "/api/v1/audio/speech",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: m,
            input: arguments_.input,
            ...(typeof arguments_.voice === "string" && arguments_.voice.trim()
              ? { voice: arguments_.voice.trim() }
              : context.webFetchMaxCharacters
                ? { max_characters: context.webFetchMaxCharacters }
                : {}),
          }),
        },
      }),
      signal,
    );
  }

  if (call.name === "generate_video") {
    if (typeof arguments_.prompt !== "string" || !arguments_.prompt.trim()) {
      return JSON.stringify({
        ok: false,
        error: "generate_video requires a non-empty prompt",
      });
    }
    const models = requestedModel
      ? [requestedModel]
      : await resolveMediaModels("video", apiKey, signal);
    if (models.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured video generation provider is available",
      });

    return generateVideo(models, arguments_.prompt, apiKey, signal);
  }

  if (call.name === "delegate_task") {
    if (typeof arguments_.task !== "string" || !arguments_.task.trim()) {
      return JSON.stringify({
        ok: false,
        error: "delegate_task requires a non-empty task",
      });
    }
    const response = await fetch("/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model.requestModel || model.id,
        stream: false,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are an ephemeral subagent. Complete only the delegated task. Be concise and return findings to the parent agent. Do not call tools, do not delegate, and do not claim actions you did not perform.",
          },
          { role: "user", content: arguments_.task.trim().slice(0, 12_000) },
        ],
      }),
      signal,
    });
    const text = await response.text();
    if (!response.ok)
      return JSON.stringify({
        ok: false,
        status: response.status,
        error: text.slice(0, MAX_RESULT_CHARS),
      });
    try {
      const payload = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      return JSON.stringify({
        ok: true,
        result:
          typeof content === "string"
            ? content
            : text.slice(0, MAX_RESULT_CHARS),
      });
    } catch {
      return JSON.stringify({
        ok: true,
        result: text.slice(0, MAX_RESULT_CHARS),
      });
    }
  }

  if (call.name === "web_fetch") {
    if (typeof arguments_.url !== "string" || !arguments_.url.trim()) {
      return JSON.stringify({
        ok: false,
        error: "web_fetch requires a public URL",
      });
    }
    const providers = await resolveWebProviders("webFetch", apiKey, signal);
    if (providers.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured web fetch provider is available",
      });

    return tryProvidersWithFallback(
      providers,
      "web fetch",
      (provider) => ({
        url: "/api/v1/web/fetch",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            provider,
            url: arguments_.url!.toString().trim(),
            ...(typeof arguments_.max_characters === "number"
              ? {
                  max_characters: Math.max(
                    500,
                    Math.min(
                      MAX_RESULT_CHARS,
                      Math.floor(arguments_.max_characters as number),
                    ),
                  ),
                }
              : {}),
          }),
        },
      }),
      signal,
    );
  }

  if (typeof arguments_.query !== "string" || !arguments_.query.trim()) {
    return JSON.stringify({
      ok: false,
      error: "web_search requires a non-empty query",
    });
  }

  const providers = await resolveWebProviders("webSearch", apiKey, signal);
  if (providers.length === 0)
    return JSON.stringify({
      ok: false,
      error: "No configured web search provider is available",
    });

  return tryProvidersWithFallback(
    providers,
    "web search",
    (provider) => ({
      url: "/api/v1/search",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          query: arguments_.query!.toString().trim(),
          provider,
          ...(typeof arguments_.max_results === "number"
            ? {
                max_results: Math.max(
                  1,
                  Math.min(10, Math.floor(arguments_.max_results as number)),
                ),
              }
            : context.webSearchMaxResults
              ? { max_results: context.webSearchMaxResults }
              : {}),
        }),
      },
    }),
    signal,
  );
}
