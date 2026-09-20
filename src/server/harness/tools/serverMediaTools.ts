import "server-only";

import {
  handleImageGeneration,
  handleTts,
  handleVideoCreate,
  handleVideoGet,
} from "@/server/llm-gateway/media";
import { buildModelsList } from "@/server/application/use-cases/http/v1/models/route";

/**
 * Image, speech and video generation, running in the durable worker.
 *
 * These were the last tools left in the browser, and none of them were there
 * for a reason that survives inspection: the generation itself has always been
 * a gateway handler on this server. What lived in the browser was the model
 * fallback loop around it, plus two accidents of environment — `btoa` for the
 * audio bytes, and an `AbortSignal` to bound the video poll. Neither exists in
 * a worker, which is why this is not simply the same code moved.
 *
 * The worker's replacement for a signal is a deadline. One run, including every
 * tool step, has to finish inside one invocation (`maxDuration` is 300s), and a
 * video poll alone was allowed 90s — eight steps of that is 720s, so the
 * platform would kill the invocation mid-loop and the run would be settled as
 * dead by the next reader. Every wait here is bounded by the run's own deadline
 * rather than by its own timeout.
 */

/** Same ceiling the browser applied. */
const MAX_RESULT_CHARS = 30_000;

/**
 * Audio is returned as a `data:` URI, which lands in the message and is re-sent
 * on every later turn — and now also written into the conversation row by the
 * worker. The browser's 10MB ceiling was set when the bytes only ever lived in
 * one tab; at ~1.37 bytes per base64 character that is 13.7MB of message.
 */
const MAX_AUDIO_BYTES = 2_000_000;

const VIDEO_POLL_INTERVAL_MS = 3_000;
/** Never spend more than this on one video, however much deadline is left. */
const VIDEO_POLL_BUDGET_MS = 90_000;

export interface MediaToolContext {
  authorization: string | null;
  /** Epoch ms this run must be finished by. Bounds every wait below. */
  deadline: number;
}

interface Attempt {
  provider: string;
  status: number;
}

function failure(error: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: false, error, ...extra });
}

function truncate(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : text;
}

function gatewayRequest(path: string, body: unknown, authorization: string | null, method = "POST"): Request {
  return new Request(`http://durable-run.local${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

/** Models for a media kind, in catalogue order — the browser read the same list. */
async function mediaModels(kind: "image" | "tts" | "video"): Promise<string[]> {
  const entries = (await buildModelsList([kind]).catch(() => [])) as Array<{ id?: unknown }>;
  const models: string[] = [];
  for (const entry of entries) {
    if (typeof entry.id === "string" && entry.id && !models.includes(entry.id)) models.push(entry.id);
  }
  return models;
}

/** Resolves the model list for a call, honouring an explicit request. */
async function candidateModels(requested: unknown, kind: "image" | "tts" | "video"): Promise<string[]> {
  const explicit = typeof requested === "string" && requested.trim() ? requested.trim() : "";
  return explicit ? [explicit] : await mediaModels(kind);
}

export async function generateImageServerSide(
  args: Record<string, unknown>,
  context: MediaToolContext,
): Promise<string> {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) return failure("generate_image requires a non-empty prompt");
  const models = await candidateModels(args.model, "image");
  if (models.length === 0) return failure("No configured image generation provider is available");

  const attempts: Attempt[] = [];
  for (const model of models) {
    if (Date.now() > context.deadline) return failure("Ran out of time before an image was generated");
    const response = await handleImageGeneration(
      gatewayRequest("/api/v1/images/generations", { model, prompt }, context.authorization),
    ).catch(() => null);
    if (!response) {
      attempts.push({ provider: model, status: 0 });
      continue;
    }
    const text = await response.text();
    if (response.ok) return truncate(text);
    attempts.push({ provider: model, status: response.status });
  }
  return failure("All providers failed for image generation", { attempts });
}

export async function textToSpeechServerSide(
  args: Record<string, unknown>,
  context: MediaToolContext,
): Promise<string> {
  const input = typeof args.input === "string" ? args.input.trim() : "";
  if (!input) return failure("text_to_speech requires non-empty input");
  const models = await candidateModels(args.model, "tts");
  if (models.length === 0) return failure("No configured text-to-speech provider is available");
  const voice = typeof args.voice === "string" && args.voice.trim() ? args.voice.trim() : undefined;

  const attempts: Attempt[] = [];
  for (const model of models) {
    if (Date.now() > context.deadline) return failure("Ran out of time before speech was generated");
    const response = await handleTts(
      gatewayRequest("/api/v1/audio/speech", { model, input, ...(voice ? { voice } : {}) }, context.authorization),
    ).catch(() => null);
    if (!response) {
      attempts.push({ provider: model, status: 0 });
      continue;
    }
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_AUDIO_BYTES) {
        return failure("Generated audio exceeds the size limit", { bytes: bytes.byteLength });
      }
      const contentType = response.headers.get("content-type") || "audio/mpeg";
      // `Buffer`, not `btoa`: the browser's helper walked the bytes in 32KB
      // chunks through `String.fromCharCode` because that is all it had.
      return JSON.stringify({ ok: true, audioUrl: `data:${contentType};base64,${bytes.toString("base64")}` });
    }
    attempts.push({ provider: model, status: response.status });
  }
  return failure("All providers failed for text to speech", { attempts });
}

/** Waits, but never past the run's deadline. Returns false when time is up. */
async function waitWithinDeadline(ms: number, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return false;
  await new Promise((resolve) => setTimeout(resolve, Math.min(ms, remaining)));
  return Date.now() < deadline;
}

async function pollVideo(
  requestId: string,
  context: MediaToolContext,
  until: number,
): Promise<{ ok: boolean; url?: string; error?: string; requestId: string }> {
  while (Date.now() < until) {
    const response = await handleVideoGet(
      gatewayRequest(`/api/v1/videos/${encodeURIComponent(requestId)}`, null, context.authorization, "GET"),
      requestId,
    ).catch(() => null);
    if (response?.ok) {
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        video?: { url?: string };
        error?: unknown;
      } | null;
      if (payload?.status === "completed" && typeof payload.video?.url === "string") {
        return { ok: true, url: payload.video.url, requestId };
      }
      if (payload?.status === "failed") {
        return {
          ok: false,
          error: typeof payload.error === "string" ? payload.error : "Video generation failed",
          requestId,
        };
      }
    }
    if (!(await waitWithinDeadline(VIDEO_POLL_INTERVAL_MS, until))) break;
  }
  // The job keeps running upstream; the id is returned so it can be collected.
  return { ok: false, error: "Video generation did not finish in time", requestId };
}

export async function generateVideoServerSide(
  args: Record<string, unknown>,
  context: MediaToolContext,
): Promise<string> {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) return failure("generate_video requires a non-empty prompt");
  const models = await candidateModels(args.model, "video");
  if (models.length === 0) return failure("No configured video generation provider is available");

  const attempts: Attempt[] = [];
  for (const model of models) {
    if (Date.now() > context.deadline) return failure("Ran out of time before a video was started");
    const response = await handleVideoCreate(
      gatewayRequest("/api/v1/videos/generations", { model, prompt }, context.authorization),
      "generations",
    ).catch(() => null);
    if (!response?.ok) {
      attempts.push({ provider: model, status: response ? response.status : 0 });
      continue;
    }
    const payload = (await response.json().catch(() => null)) as { request_id?: unknown } | null;
    if (typeof payload?.request_id !== "string" || !payload.request_id) {
      attempts.push({ provider: model, status: response.status });
      continue;
    }
    const until = Math.min(context.deadline, Date.now() + VIDEO_POLL_BUDGET_MS);
    return JSON.stringify(await pollVideo(payload.request_id, context, until));
  }
  return failure("All providers failed for video generation", { attempts });
}
