import { createErrorResult } from "../utils/error";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { refreshTokenByProvider } from "../services/tokenRefresh";
import { PROVIDER_MEDIA } from "../providers/index";

// Upstream fetch deadline for video job submission/polling (the job itself is
// async upstream — this only bounds the HTTP round-trip, not video rendering).
const VIDEO_FETCH_TIMEOUT_MS = Number(process.env.VIDEO_FETCH_TIMEOUT_MS || 120000);

// POST /videos/* creates a billable upstream job. A network error after the
// request left the socket may still have created the job, so creation is NEVER
// auto-retried (the only re-send is the auth retry after a 401/403 refresh,
// which upstream rejects before job creation).
const VIDEO_ACTIONS = new Set(["generations", "edits", "extensions"]);

export function getVideoConfig(provider: string): Record<string, unknown> | null {
  return (PROVIDER_MEDIA[provider]?.videoConfig as Record<string, unknown>) || null;
}

/** Strip bearer tokens / obvious secrets from text destined for clients or logs. */
export function sanitizeSecrets(text: unknown, credentials: Record<string, unknown> | null = null): string {
  if (!text) return String(text ?? "");
  let out = String(text).replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
  for (const key of ["accessToken", "refreshToken", "apiKey"]) {
    const secret = credentials?.[key];
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

function buildUpstreamUrl(config: Record<string, unknown>, action: string | null, requestId: string | null): string {
  const base = (config.baseUrl as string).replace(/\/$/, "");
  return requestId ? `${base}/${encodeURIComponent(requestId)}` : `${base}/${action}`;
}

function buildHeaders({ token, contentType, idempotencyKey }: { token: string | null; contentType: string | null; idempotencyKey: string | null }): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers["Content-Type"] = contentType;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

function combineSignals(signal: AbortSignal | undefined | null, timeoutMs: number): AbortSignal | undefined {
  const timeoutSignal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : null;
  if (signal && timeoutSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal || timeoutSignal || undefined;
}

/**
 * Transparent proxy for async video jobs (xAI Grok Imagine shape).
 *
 * - Forwards the raw body byte-for-byte (JSON or multipart) — no reshaping.
 * - Passes upstream JSON (request_id, status, video.url, error) back verbatim.
 * - 401/403 with a refresh token: refresh ONCE, retry ONCE. No other retry.
 * - Upstream error text is sanitized before it reaches the client.
 */
export async function handleVideoProxyCore({
  provider,
  action = null,
  requestId = null,
  rawBody = null,
  contentType = null,
  idempotencyKey = null,
  credentials,
  signal,
  timeoutMs = VIDEO_FETCH_TIMEOUT_MS,
  log,
  onCredentialsRefreshed,
}: {
  provider: string;
  action?: string | null;
  requestId?: string | null;
  rawBody?: Buffer | string | null;
  contentType?: string | null;
  idempotencyKey?: string | null;
  credentials: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  log?: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void };
  onCredentialsRefreshed?: (creds: Record<string, unknown>) => void | Promise<void>;
}) {
  const config = getVideoConfig(provider);
  if (!config) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support video generation`);
  }
  if (!requestId && !VIDEO_ACTIONS.has(action!)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Unknown video action: ${action}`);
  }

  const method = requestId ? "GET" : "POST";
  const url = buildUpstreamUrl(config, action, requestId);
  const fetchSignal = combineSignals(signal, timeoutMs);

  const doFetch = (token: string | null) =>
    fetch(url, {
      method,
      headers: buildHeaders({ token, contentType: method === "POST" ? contentType : null, idempotencyKey: method === "POST" ? idempotencyKey : null }),
      body: method === "POST" ? rawBody as BodyInit | undefined : undefined,
      signal: fetchSignal,
    });

  let upstream: Response;
  try {
    upstream = await doFetch((credentials?.accessToken || credentials?.apiKey) as string || null);
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      return createErrorResult(HTTP_STATUS.REQUEST_TIMEOUT, `[${provider}] video ${method} aborted: ${err.message}`);
    }
    // Never re-send a creation POST on network error — the job may already exist upstream.
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video upstream fetch failed: ${err.message}`, credentials));
  }

  // 401/403 → refresh once → retry once (OAuth accounts only; API keys can't refresh)
  if (
    (upstream.status === HTTP_STATUS.UNAUTHORIZED || upstream.status === HTTP_STATUS.FORBIDDEN) &&
    credentials?.refreshToken
  ) {
    let refreshed: Record<string, unknown> | null = null;
    try {
      refreshed = await refreshTokenByProvider(provider, credentials, log);
    } catch (error: unknown) {
      log?.warn?.("TOKEN", `${provider} | video refresh error: ${sanitizeSecrets((error as Error).message, credentials)}`);
    }
    if (refreshed?.accessToken) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for video ${method}`);
      Object.assign(credentials, refreshed);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(refreshed);
      try {
        await upstream.body?.cancel?.();
      } catch { /* noop */ }
      try {
        upstream = await doFetch((credentials.accessToken || credentials.apiKey) as string || null);
      } catch (error: unknown) {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, sanitizeSecrets(`[${provider}] video retry after refresh failed: ${(error as Error).message}`, credentials));
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | video refresh failed — account needs re-auth`);
    }
  }

  const bodyText = await upstream.text().catch(() => "");

  if (!upstream.ok) {
    const message = sanitizeSecrets(bodyText || `HTTP ${upstream.status}`, credentials);
    return createErrorResult(upstream.status, `[${provider}] ${message.slice(0, 2000)}`);
  }

  // Success: pass the upstream JSON through untouched (request_id / status / video.url).
  return {
    success: true,
    response: new Response(bodyText, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
