/**
 * Shared helpers for pass-through-SSE web-session executors: upstream
 * returns OpenAI-compatible SSE that is forwarded verbatim to the client
 * (currently venice-web — every other former consumer here was ported to a
 * bespoke, provider-specific flow as its real protocol was verified).
 *
 * Provider-specific bits (URLs, origins, auth, error messages) are passed
 * as config objects.
 */

import { SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import type { Credentials, Logger } from "../services/types";

// ── Common constants ────────────────────────────────────────────────────────

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const COMMON_HEADERS: Record<string, string> = {
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Content-Type": "application/json",
  "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": DEFAULT_USER_AGENT,
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface WebExecuteParams {
  model: string;
  body: Record<string, unknown>;
  stream: boolean;
  credentials: Credentials;
  signal?: AbortSignal;
  log?: Logger;
}

export interface WebExecuteResult {
  response: Response;
  url: string;
  headers: Record<string, string>;
  transformedBody: Record<string, unknown>;
}

/** Config for pass-through SSE executors. */
export interface PassThroughWebConfig {
  /** Human-readable provider name for error messages (e.g. "Venice"). */
  providerName: string;
  /** Log tag (e.g. "VENICE-WEB"). */
  logTag: string;
  /** Upstream API URL. */
  apiUrl: string;
  /** Origin header value (e.g. "https://venice.ai"). */
  origin: string;
  /** Referer header value (e.g. "https://venice.ai/"). */
  referer: string;
  /** Default model when caller doesn't supply one. */
  defaultModel: string;
  /** Auth-failure hint shown to the user. */
  authErrorMessage: string;
  /** Build the auth header(s) from credentials. */
  buildAuthHeaders(credentials: Credentials): Record<string, string>;
  /** Override Accept header (default: "text/event-stream, *"). */
  acceptHeader?: string;
  /** Override Accept-Language (default: "en-US,en;q=0.9"). */
  acceptLanguage?: string;
}

// ── Shared execute helpers ──────────────────────────────────────────────────

function buildBrowserHeaders(
  origin: string,
  referer: string,
  acceptHeader?: string,
  acceptLanguage?: string,
): Record<string, string> {
  return {
    ...COMMON_HEADERS,
    Accept: acceptHeader ?? "text/event-stream, */*",
    ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
    Origin: origin,
    Pragma: "no-cache",
    Referer: referer,
  };
}

function missingMessagesResponse(apiUrl: string): WebExecuteResult {
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: "Missing or empty messages array",
          type: "invalid_request",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ),
    url: apiUrl,
    headers: {} as Record<string, string>,
    transformedBody: {},
  };
}

function connectionErrorResponse(
  providerName: string,
  errMsg: string,
  apiUrl: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): WebExecuteResult {
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: `${providerName} connection failed: ${errMsg}`,
          type: "upstream_error",
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ),
    url: apiUrl,
    headers,
    transformedBody: payload,
  };
}

function httpErrorResponse(
  providerName: string,
  status: number,
  authErrorMessage: string,
  apiUrl: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  log: Logger | undefined,
  logTag: string,
): WebExecuteResult {
  let errMsg = `${providerName} returned HTTP ${status}`;
  if (status === 401 || status === 403) errMsg = authErrorMessage;
  else if (status === 429)
    errMsg = `${providerName} rate limited. Wait a moment and retry.`;
  log?.warn?.(logTag, errMsg);
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: errMsg,
          type: "upstream_error",
          code: `HTTP_${status}`,
        },
      }),
      { status, headers: { "Content-Type": "application/json" } },
    ),
    url: apiUrl,
    headers,
    transformedBody: payload,
  };
}

function emptyBodyErrorResponse(
  providerName: string,
  apiUrl: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): WebExecuteResult {
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: `${providerName} returned empty response body`,
          type: "upstream_error",
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ),
    url: apiUrl,
    headers,
    transformedBody: payload,
  };
}

// ── Pass-through SSE executor ───────────────────────────────────────────────

/**
 * Execute a pass-through SSE web provider.  The upstream response body is
 * forwarded verbatim (streaming) or returned as-is (non-streaming).
 */
export async function executePassThroughWeb(
  config: PassThroughWebConfig,
  params: WebExecuteParams,
): Promise<WebExecuteResult> {
  const { model, body, stream, credentials, signal, log } = params;
  const {
    providerName,
    logTag,
    apiUrl,
    origin,
    referer,
    defaultModel,
    authErrorMessage,
    buildAuthHeaders,
    acceptHeader,
    acceptLanguage,
  } = config;

  const messages = body?.messages as Record<string, unknown>[] | undefined;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return missingMessagesResponse(apiUrl);
  }

  const headers: Record<string, string> = {
    ...buildBrowserHeaders(origin, referer, acceptHeader, acceptLanguage),
    ...buildAuthHeaders(credentials),
  };

  const payload: Record<string, unknown> = {
    ...body,
    model: model || defaultModel,
    stream: stream !== false,
  };

  log?.info?.(logTag, `Query to ${model}, stream=${stream}`);

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log?.error?.(logTag, `Fetch failed: ${errMsg}`);
    return connectionErrorResponse(providerName, errMsg, apiUrl, headers, payload);
  }

  if (!response.ok) {
    return httpErrorResponse(
      providerName,
      response.status,
      authErrorMessage,
      apiUrl,
      headers,
      payload,
      log,
      logTag,
    );
  }

  if (!response.body) {
    return emptyBodyErrorResponse(providerName, apiUrl, headers, payload);
  }

  // Pass through SSE directly
  if (stream !== false) {
    return {
      response: new Response(response.body, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      }),
      url: apiUrl,
      headers,
      transformedBody: payload,
    };
  }

  return { response, url: apiUrl, headers, transformedBody: payload };
}
