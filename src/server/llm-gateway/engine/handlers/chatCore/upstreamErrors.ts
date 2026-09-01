import { createErrorResult, parseUpstreamError, formatProviderError } from "../../utils/error";
import { HTTP_STATUS } from "../../config/runtimeConfig";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "../../host/usage";
import { getExecutor } from "../../executors/index";
import { buildRequestDetail, extractRequestConfig } from "./requestDetail";
import { refreshWithRetry } from "../../services/tokenRefresh";
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

