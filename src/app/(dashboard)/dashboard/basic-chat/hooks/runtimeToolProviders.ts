// Provider/model resolution and the media generation paths (image, audio,
// video) behind the runtime tools. Kept apart from the tool dispatcher so
// neither file outgrows the module size the architecture gate enforces.
import type { HarnessMcpServer, NormalizedModel } from "../types";

export const MAX_RESULT_CHARS = 30_000;
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
export async function resolveWebProviders(
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
export async function resolveMediaModels(
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

export interface RuntimeToolContext {
  apiKey: string;
  model: NormalizedModel;
  signal: AbortSignal;
  enabledToolNames?: ReadonlySet<string>;
  enabledSkillIds?: ReadonlySet<string>;
  mcpServers?: readonly HarnessMcpServer[];
  sessionId?: string;
  webSearchMaxResults?: number;
  webFetchMaxCharacters?: number;
  // "skill/queued" means the write is sitting in the approval queue and the
  // skill does not exist yet — distinct from created/updated on purpose, so the
  // run journal does not claim a skill landed when it did not.
  onSkillEvent?: (type: "skill/load" | "skill/created" | "skill/updated" | "skill/queued", data: Record<string, unknown>) => void;
  onMemoryEvent?: (
    type: "memory/add" | "memory/replace" | "memory/remove",
    data: Record<string, unknown>,
  ) => void;
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
export async function tryProvidersWithFallback(
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
export async function tryModelsForAudio(
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
export async function generateVideo(
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
