import { createErrorResult, parseUpstreamError, formatProviderError } from "../../utils/error";
import { HTTP_STATUS } from "../../config/runtimeConfig";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "../../host/usage";
import { getExecutor } from "../../executors/index";
import { buildRequestDetail, extractRequestConfig } from "./requestDetail";
import { refreshWithRetry } from "../../services/tokenRefresh";
import { isToolUnsupportedError } from "../../services/accountFallback";
import type { ChatCredentials, ChatLogger, PxpipeSummary, RequestLogger, StreamController } from "./types";

type Executor = ReturnType<typeof getExecutor>;

// ---------------------------------------------------------------------------
// Execution error handling (catch block of executor.execute)
// ---------------------------------------------------------------------------

export async function handleExecutionError(params: {
  error: unknown;
  provider: string;
  model: string;
  connectionId: string;
  requestStartTime: number;
  body: Record<string, unknown>;
  stream: boolean;
  translatedBody: Record<string, unknown> | null;
  pxpipeSummary: PxpipeSummary | null;
  reqTag: string;
  log?: ChatLogger;
  streamController: StreamController;
}): Promise<ReturnType<typeof createErrorResult>> {
  const { error, provider, model, connectionId, requestStartTime, body, stream, translatedBody, pxpipeSummary, reqTag, log, streamController } = params;
  const err = error instanceof Error ? error : new Error(String(error));
  trackPendingRequest(model, provider, connectionId, false, true);
  appendRequestLog().catch(() => { });
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: translatedBody || null,
    response: { error: err.message || String(err), status: err.name === "AbortError" ? 499 : 502, thinking: null },
    pxpipe: pxpipeSummary,
    status: "error"
  })).catch(() => { });

  if (err.name === "AbortError") {
    streamController.handleError(err);
    return createErrorResult(499, "Request aborted", undefined);
  }
  const errMsg = formatProviderError(err as Error & { code?: string; cause?: { code?: string; message?: string } }, provider, model, HTTP_STATUS.BAD_GATEWAY);
  if (log?.errorLine) {
    log.errorLine(reqTag, "✗", `ERROR 502 · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${err.stack ? `\n    ${err.stack}` : ""}`);
  }
  return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg, undefined);
}

// ---------------------------------------------------------------------------
// 401/403 token refresh + retry
// ---------------------------------------------------------------------------

export async function attemptTokenRefresh(params: {
  executor: Executor;
  providerResponse: Response;
  providerUrl: string | undefined;
  providerResponseFormat: string;
  credentials: ChatCredentials;
  onCredentialsRefreshed?: (creds: ChatCredentials) => void | Promise<void>;
  executeParams: { model: string; body: Record<string, unknown>; stream: boolean; signal: AbortSignal; log?: ChatLogger; proxyOptions: Record<string, unknown> };          
  provider: string;
  model: string;
  reqTag: string;
  log?: ChatLogger;
}): Promise<{ providerResponse: Response; providerUrl: string | undefined; providerResponseFormat: string }> {
  const { executor, providerResponse, providerUrl, providerResponseFormat, credentials, onCredentialsRefreshed, executeParams, provider, model, reqTag, log } = params;
  try {
    // Mutate credentials after each successful refresh: rotating refresh_token
    // providers (xAI/grok-cli) issue a new RT on every refresh; without this,
    // refreshWithRetry's 2nd/3rd attempt reuses the already-consumed RT →
    // invalid_grant → auth_failed retryable=false.
    const newCredentials = await refreshWithRetry(async () => {
      const result = await executor.refreshCredentials(credentials, log);
      if (result?.refreshToken && result.refreshToken !== credentials.refreshToken) {
        if (result.accessToken) credentials.accessToken = result.accessToken;
        credentials.refreshToken = result.refreshToken;
      }
      return result;
    }, 3, log);
    if (newCredentials?.accessToken || newCredentials?.copilotToken) {
      if (log?.line) log.line(reqTag, "🔑", `TOKEN REFRESHED · ${provider}/${model}`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) {
        try { await onCredentialsRefreshed(newCredentials); } catch (e: unknown) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e instanceof Error ? e.message : String(e)}`); }
      }
      try {
        const retryResult = await executor.execute({ ...executeParams, credentials });
        if (retryResult.response.ok) {
          return {
            providerResponse: retryResult.response,
            providerUrl: retryResult.url,
            providerResponseFormat: retryResult.responseFormat || providerResponseFormat,
          };
        }
      } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  } catch (e: unknown) {
    log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { providerResponse, providerUrl, providerResponseFormat };
}

// ---------------------------------------------------------------------------
// Upstream error response (!ok)
// ---------------------------------------------------------------------------

export async function handleUpstreamError(params: {
  providerResponse: Response;
  providerUrl: string | undefined;
  executor: Executor;
  provider: string;
  model: string;
  connectionId: string;
  requestStartTime: number;
  body: Record<string, unknown>;
  stream: boolean;
  translatedBody: Record<string, unknown>;
  finalBody: Record<string, unknown> | undefined;
  pxpipeSummary: PxpipeSummary | null;
  reqTag: string;
  log?: ChatLogger;
  reqLogger: RequestLogger;
}): Promise<ReturnType<typeof createErrorResult>> {
  const { providerResponse, providerUrl, executor, provider, model, connectionId, requestStartTime, body, stream, translatedBody, finalBody, pxpipeSummary, reqTag, log, reqLogger } = params;
  trackPendingRequest(model, provider, connectionId, false, true);
  const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
  appendRequestLog().catch(() => { });
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    response: { error: message, status: statusCode, thinking: null },
    pxpipe: pxpipeSummary,
    status: "error"
  })).catch(() => { });

  const errMsg = formatProviderError(new Error(message) as Error & { code?: string; cause?: { code?: string; message?: string } }, provider, model, statusCode);
  if (log?.errorLine) {
    const urlStr = providerUrl ? `\n    URL: ${providerUrl}` : "";
    log.errorLine(reqTag, "✗", `ERROR ${statusCode} · ${provider}/${model} · ${Date.now() - requestStartTime}ms${urlStr}\n    ${errMsg}`);
  }
  reqLogger.logError(new Error(message), finalBody || translatedBody);
  return createErrorResult(statusCode, errMsg, resetsAtMs);
}


// ---------------------------------------------------------------------------
// Tool-unsupported retry
// ---------------------------------------------------------------------------

/**
 * The tools ride along because the *session* has plugins enabled, not because
 * the turn needs them, so the whole message failing is the wrong trade: retry
 * once without them. `isToolUnsupportedError` owns what the error looks like —
 * account rotation reads the same rule, so the two cannot drift.
 */

/** Whether the translated body is asking the provider for tool calling. */
export function bodyHasTools(body: Record<string, unknown>): boolean {
  const nested = body.request as Record<string, unknown> | undefined;
  const tools = body.tools ?? nested?.tools ?? body.functions ?? nested?.functions;
  return Array.isArray(tools) && tools.length > 0;
}

/** Copy without any tool-calling key, in any of the three target formats. */
function stripTools(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  for (const key of ["tools", "tool_choice", "toolConfig", "tool_config", "functions", "function_call"]) {
    delete out[key];
  }
  // Gemini's translated body nests the payload under `request`.
  if (out.request && typeof out.request === "object") {
    out.request = stripTools(out.request as Record<string, unknown>);
  }
  return out;
}

/**
 * Re-run the request with the tools removed when the upstream error says the
 * model cannot do tool calling. Any other error is handed back untouched.
 *
 * Whatever the retry answers is what the caller gets, including a failure: once
 * the tools are gone the first error has been dealt with, and the second one is
 * the state of the world. Reporting the tool-use 404 over a 429 sent the user
 * hunting a plugin switch when the real answer was to wait — and cost the
 * account the rate-limit backoff, because cooldowns are classified from the
 * status that is returned.
 *
 * The error body has to be read to decide, which consumes the response, so a
 * response that is handed back is rebuilt from the text already read.
 */
export async function retryWithoutTools(params: {
  executor: Executor;
  providerResponse: Response;
  providerUrl: string | undefined;
  providerResponseFormat: string;
  translatedBody: Record<string, unknown>;
  executeParams: {
    model: string;
    stream: boolean;
    credentials: ChatCredentials;
    signal: AbortSignal;
    log?: ChatLogger;
    proxyOptions: Record<string, unknown>;
  };
  provider: string;
  model: string;
  reqTag: string;
  log?: ChatLogger;
}): Promise<{
  providerResponse: Response;
  providerUrl: string | undefined;
  providerResponseFormat: string;
  translatedBody: Record<string, unknown>;
  finalBody?: Record<string, unknown>;
}> {
  const { executor, providerResponse, providerUrl, providerResponseFormat, translatedBody, executeParams, provider, model, reqTag, log } = params;
  const unchanged = { providerResponse, providerUrl, providerResponseFormat, translatedBody };

  let bodyText = "";
  try { bodyText = await providerResponse.text(); } catch { /* empty body */ }

  // Rebuild what was just consumed. `content-encoding`/`content-length` describe
  // the wire bytes, which this body no longer is.
  const headers = new Headers(providerResponse.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  const restored = () => ({
    ...unchanged,
    providerResponse: new Response(bodyText, {
      status: providerResponse.status,
      statusText: providerResponse.statusText,
      headers,
    }),
  });

  if (!isToolUnsupportedError(bodyText)) return restored();

  const withoutTools = stripTools(translatedBody);
  log?.warn?.("TOOLS", `${provider.toUpperCase()} | ${model} has no tool-calling endpoint — retrying without tools`);
  try {
    const retry = await executor.execute({ ...executeParams, body: withoutTools });
    if (log?.line) {
      const outcome = retry.response.ok ? "retry succeeded" : `retry failed ${retry.response.status}`;
      log.line(reqTag, "🔧", `TOOLS DROPPED · ${provider}/${model} · ${outcome}`);
    }
    return {
      providerResponse: retry.response,
      providerUrl: retry.url,
      providerResponseFormat: retry.responseFormat || providerResponseFormat,
      translatedBody: withoutTools,
      finalBody: retry.transformedBody,
    };
  } catch (e: unknown) {
    // No second response at all: the first error is still the only thing to report.
    log?.warn?.("TOOLS", `${provider.toUpperCase()} | retry without tools threw: ${e instanceof Error ? e.message : String(e)}`);
    return restored();
  }
}
