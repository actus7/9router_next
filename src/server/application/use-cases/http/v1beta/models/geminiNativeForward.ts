import {
  clearAccountError,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "@/server/llm-gateway/auth/accountSelection";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { PROVIDER_MODELS } from "@/shared/constants/models";
import { GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS } from "@/server/llm-gateway";
import { resolveAccountExhaustion } from "@/server/llm-gateway/engine/services/accountFallback";

/**
 * Gemini's native (non-translated) request path, used for TTS.
 *
 * Split out of the v1beta route so that file stays inside the project's
 * 600-line ceiling, and because this is a genuinely separate concern: the rest
 * of the route translates Gemini <-> the internal OpenAI shape and goes through
 * `handleChat`, while this forwards straight upstream with its own account
 * loop.
 *
 * It also keeps its own API-key gate. That is deliberate, not duplication for
 * its own sake: the shared `requireGatewayApiKey` returns OpenAI-shaped errors,
 * and a Gemini client parses `{ error: { message } }`. The behaviour matches —
 * same `settings.requireApiKey` check, same three key locations, same
 * `isValidApiKey` — only the envelope differs.
 */

const GEMINI_NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_NATIVE_MODEL_PATTERN = /^[a-zA-Z0-9_.:-]+$/;

function extractGeminiClientApiKey(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey) return googleApiKey;

  const url = new URL(request.url);
  return url.searchParams.get("key");
}

function normalizeGeminiNativeModel(model: string) {
  return String(model || "")
    .replace(/^models\//, "")
    .replace(/^gemini\//, "");
}

function getGeminiTtsModelIds() {
  return new Set([
    ...(PROVIDER_MODELS.gemini || [])
      .filter((model) => (model.kind || model.type) === "tts")
      .map((model) => model.id),
    ...(PROVIDER_MODELS["gemini-tts-models"] || []).map((model) => model.id),
  ]);
}

function hasAudioResponseModality(body: Record<string, unknown>) {
  const genConfig = body?.generationConfig as Record<string, unknown> | undefined;
  const modalities = genConfig?.responseModalities;
  return Array.isArray(modalities)
    && modalities.some((modality) => String(modality).toUpperCase() === "AUDIO");
}

export function isGeminiNativeTtsRequest(model: string, body: Record<string, unknown>) {
  const rawModel = String(model || "");
  if (rawModel.includes("/") && !rawModel.startsWith("gemini/") && !rawModel.startsWith("models/")) {
    return false;
  }

  const modelId = normalizeGeminiNativeModel(model);
  return hasAudioResponseModality(body) || getGeminiTtsModelIds().has(modelId);
}

function buildGeminiNativeUrl(requestUrl: string, model: string, action: string) {
  const sourceUrl = new URL(requestUrl);
  const upstreamUrl = new URL(`${GEMINI_NATIVE_BASE_URL}/${normalizeGeminiNativeModel(model)}${action}`);

  for (const [key, value] of sourceUrl.searchParams.entries()) {
    if (key === "key") continue;
    upstreamUrl.searchParams.append(key, value);
  }

  return upstreamUrl.toString();
}

async function validateGeminiNativeClientKey(request: Request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;

  const apiKey = extractGeminiClientApiKey(request);
  if (!apiKey) {
    return Response.json({ error: { message: "Missing API key" } }, { status: 401 });
  }

  const valid = await isValidApiKey(apiKey);
  if (!valid) {
    return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
  }

  return null;
}

function buildGeminiNativeAuthHeaders(credentials: Record<string, unknown>): Record<string, string> | null {
  if (credentials?.apiKey) return { "x-goog-api-key": credentials.apiKey as string };
  if (credentials?.accessToken) return { Authorization: `Bearer ${credentials.accessToken}` };
  return null;
}

function corsHeadersFrom(response: Response) {
  const headers = new Headers(response.headers);
  // Node fetch may expose a decoded body while preserving upstream compression
  // headers. Forwarding those headers makes clients decompress plain bytes again.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function getSafeGeminiConnectionLabel(credentials: Record<string, unknown>) {
  const connectionId = String(credentials?.connectionId || "unknown");
  const shortId = connectionId.slice(0, 8);
  const connectionName = String(credentials?.connectionName || "");
  if (!connectionName || connectionName.includes("@")) return shortId;
  return `${connectionName}:${shortId}`;
}

function getGeminiNativeErrorCode(error: unknown) {
  const e = error as Record<string, unknown>;
  const cause = e?.cause as Record<string, unknown> | undefined;
  return (cause?.code || e?.code || cause?.name || e?.name || "UNKNOWN") as string;
}

function isGeminiNativeTimeoutError(error: unknown, timedOut: boolean) {
  if (timedOut) return true;
  const code = getGeminiNativeErrorCode(error);
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "HeadersTimeoutError";
}

function getSafeGeminiNativeErrorText(error: unknown) {
  const e = error as Record<string, unknown>;
  const message = (e?.message as string) || String(error);
  const code = getGeminiNativeErrorCode(error);
  return `${message} (${code})`;
}

export async function forwardGeminiNativeRequest(request: Request, body: Record<string, unknown>, model: string, action: string) {
  const authError = await validateGeminiNativeClientKey(request);
  if (authError) return authError;

  const modelId = normalizeGeminiNativeModel(model);
  if (!GEMINI_NATIVE_MODEL_PATTERN.test(modelId)) {
    return Response.json({ error: { message: "Invalid model" } }, { status: 400 });
  }
  const excludeConnectionIds = new Set<string>();
  const bodyText = JSON.stringify(body);
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials("gemini", excludeConnectionIds, modelId);
    if (!credentials || credentials.allRateLimited) {
      // Same decision the chat and embeddings loops use. This path used to
      // answer 503 for "no gemini account configured" while the others answered
      // 404 — the third copy of the drift the shared resolver exists to stop.
      // The Gemini error envelope is kept: a Gemini client parses this shape,
      // so only the status and message come from the shared decision.
      const exhaustion = resolveAccountExhaustion(
        "gemini", modelId, credentials, excludeConnectionIds.size, lastError, lastStatus,
      );
      console.error(`[GEMINI_NATIVE] exhausted model=${modelId} kind=${exhaustion.kind} status=${exhaustion.status} error=${exhaustion.message}`);
      return Response.json(
        { error: { message: exhaustion.message } },
        {
          status: exhaustion.status,
          ...(exhaustion.kind === "rate-limited" && exhaustion.retryAfter
            ? { headers: { "Retry-After": exhaustion.retryAfter } }
            : {}),
        }
      );
    }

    const authHeaders = buildGeminiNativeAuthHeaders(credentials as unknown as Record<string, unknown>);
    if (!authHeaders) {
      return Response.json(
        { error: { message: "No Gemini API key configured" } },
        { status: 404 }
      );
    }

    const safeConnection = getSafeGeminiConnectionLabel(credentials as unknown as Record<string, unknown>);
    const startedAt = Date.now();
    const upstreamUrl = buildGeminiNativeUrl(request.url, modelId, action);
    const attemptController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS);
    const abortAttempt = () => attemptController.abort();

    if (request.signal?.aborted) {
      console.error(`[GEMINI_NATIVE] client aborted model=${modelId} ms=0 conn=${safeConnection}`);
      return Response.json({ error: { message: "Client closed request" } }, { status: 499 });
    }

    request.signal?.addEventListener("abort", abortAttempt, { once: true });
    console.error(`[GEMINI_NATIVE] start model=${modelId} action=${action} conn=${safeConnection} body=${Buffer.byteLength(bodyText)}B timeout=${GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS}`);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("Content-Type") || "application/json",
          ...authHeaders,
        },
        body: bodyText,
        signal: attemptController.signal,
      });
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      if (request.signal?.aborted && !timedOut) {
        console.error(`[GEMINI_NATIVE] client aborted model=${modelId} ms=${durationMs} conn=${safeConnection}`);
        return Response.json({ error: { message: "Client closed request" } }, { status: 499 });
      }

      const status = isGeminiNativeTimeoutError(error, timedOut) ? 504 : 502;
      const errorText = getSafeGeminiNativeErrorText(error);
      console.error(`[GEMINI_NATIVE] fetch failed model=${modelId} status=${status} ms=${durationMs} conn=${safeConnection} error=${errorText}`);

      const { shouldFallback } = await markAccountUnavailable(
        credentials.connectionId as string,
        status,
        errorText,
        "gemini",
        modelId
      );

      if (shouldFallback) {
        excludeConnectionIds.add(credentials.connectionId as string);
        lastError = errorText;
        lastStatus = status;
        console.error(`[GEMINI_NATIVE] fallback model=${modelId} status=${status} conn=${safeConnection} exclude=${excludeConnectionIds.size}`);
        continue;
      }

      return Response.json({ error: { message: errorText } }, { status });
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortAttempt);
    }

    console.error(`[GEMINI_NATIVE] upstream model=${modelId} status=${upstreamResponse.status} ms=${Date.now() - startedAt} conn=${safeConnection} ct=${upstreamResponse.headers.get("content-type") || "?"} cl=${upstreamResponse.headers.get("content-length") || "?"}`);

    if (upstreamResponse.ok) {
      await clearAccountError(credentials.connectionId as string, credentials as unknown as Record<string, unknown>, modelId);
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: corsHeadersFrom(upstreamResponse),
      });
    }

    const errorText = await upstreamResponse.text();
    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId as string,
      upstreamResponse.status,
      errorText,
      "gemini",
      modelId
    );

    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId as string);
      lastError = errorText;
      lastStatus = upstreamResponse.status;
      continue;
    }

    return new Response(errorText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: corsHeadersFrom(upstreamResponse),
    });
  }
}
