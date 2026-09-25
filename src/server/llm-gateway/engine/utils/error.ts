import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig";

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode: number, message: string) {
  const errorInfo = ERROR_TYPES[statusCode as keyof typeof ERROR_TYPES] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode as keyof typeof DEFAULT_ERROR_MESSAGES] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode: number, message: string) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/** Anthropic `error.type` for an HTTP status (docs: api/errors). */
function anthropicErrorType(statusCode: number): string {
  switch (statusCode) {
    case 400: return "invalid_request_error";
    case 401: return "authentication_error";
    case 403: return "permission_error";
    case 404: return "not_found_error";
    case 413: return "request_too_large";
    case 429: return "rate_limit_error";
    case 503:
    case 529: return "overloaded_error";
    default: return statusCode >= 500 ? "api_error" : "invalid_request_error";
  }
}

export function anthropicErrorBody(statusCode: number, message: string) {
  return { type: "error", error: { type: anthropicErrorType(statusCode), message } };
}

/**
 * Re-shape an OpenAI-style error Response into Anthropic's envelope, keeping
 * status and headers (Retry-After). Applied once at the /v1/messages boundary
 * instead of threading sourceFormat through every error site: errors come from
 * the route wrapper, chat.ts, chatCore and the streaming guards alike, and the
 * SDK classifies failures by `error.type`, so one missed site is a wrong class.
 */
export async function toAnthropicErrorResponse(response: Response): Promise<Response> {
  if (response.ok || !(response.headers.get("content-type") || "").includes("application/json")) return response;
  let body: { type?: string; error?: unknown; message?: unknown };
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (body?.type === "error") return response;
  const err = body?.error;
  const message = typeof err === "string" ? err
    : (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") ? (err as { message: string }).message
    : typeof body?.message === "string" ? body.message
    : DEFAULT_ERROR_MESSAGES[response.status as keyof typeof DEFAULT_ERROR_MESSAGES] || "An error occurred";
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(anthropicErrorBody(response.status, message)), { status: response.status, statusText: response.statusText, headers });
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
 */
export async function parseUpstreamError(response: Response, executor: { parseError?: (response: Response, bodyText: string) => Record<string, unknown> } | null = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const msg = (parsed.message as string) || DEFAULT_ERROR_MESSAGES[response.status as keyof typeof DEFAULT_ERROR_MESSAGES] || `Upstream error: ${response.status}`;
        return { statusCode: (parsed.status as number) || response.status, message: msg, resetsAtMs: parsed.resetsAtMs as number | undefined };
      }
    } catch { /* fall through to default parsing */ }
  }

  let message = "";
  try {
    const json = JSON.parse(bodyText);
    message = json.error?.message || json.message || json.error || bodyText;
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || DEFAULT_ERROR_MESSAGES[response.status as keyof typeof DEFAULT_ERROR_MESSAGES] || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode: number, message: string, resetsAtMs?: number) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message)
  };
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(statusCode: number, message: string, retryAfter: string, retryAfterHuman: string) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify(buildErrorBody(statusCode, msg)),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec)
      }
    }
  );
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(error: Error & { code?: string; cause?: { code?: string; message?: string } }, provider: string, model: string, statusCode: string | number) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}
