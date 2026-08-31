import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { refreshWithRetry } from "../services/tokenRefresh";
import { getExecutor } from "../executors/index";
import { getImageAdapter } from "./imageProviders/index";
import { urlToBase64 } from "./imageProviders/_base";

type ImageAdapter = NonNullable<ReturnType<typeof getImageAdapter>>;

function serializeRequestBody(requestBody: unknown) {
  if (typeof FormData !== "undefined" && requestBody instanceof FormData) return requestBody;
  if (typeof requestBody === "string") return requestBody;
  return JSON.stringify(requestBody);
}

function resolveBinaryMime(fmt: string): string {
  if (fmt === "jpeg" || fmt === "jpg") return "image/jpeg";
  if (fmt === "webp") return "image/webp";
  return "image/png";
}

async function buildBinaryImageResponse(
  body: Record<string, unknown>,
  finalBody: Record<string, unknown>,
): Promise<{ success: true; response: Response } | null> {
  const data = finalBody.data as Record<string, unknown>[] | undefined;
  const first = data?.[0];
  let b64 = first?.b64_json as string | undefined;
  if (!b64 && first?.url) {
    try { b64 = await urlToBase64(first.url as string); } catch {}
  }
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  const fmt = ((body.output_format as string) || "png").toLowerCase();
  const mime = resolveBinaryMime(fmt);
  return {
    success: true,
    response: new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`,
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

function buildJsonImageResponse(finalBody: Record<string, unknown>) {
  return {
    success: true,
    response: new Response(JSON.stringify(finalBody), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

function normalizeFinalBody(
  adapter: ImageAdapter,
  parsed: unknown,
  prompt: unknown,
): Record<string, unknown> {
  const normalized = adapter.normalize(parsed, prompt);
  return (normalized.created && Array.isArray(normalized.data)) ? normalized : parsed as Record<string, unknown>;
}

async function executeViaExecutor(
  adapter: ImageAdapter,
  model: string,
  body: Record<string, unknown>,
  credentials: Record<string, unknown>,
  log: { debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void } | undefined,
  binaryOutput: boolean,
  onRequestSuccess?: () => void | Promise<void>,
) {
  try {
    log?.debug?.("IMAGE", `${model} | prompt="${(body.prompt as string).slice(0, 50)}..." (executor)`);
    const responseBody = await adapter.executeViaExecutor!(model, body, credentials, log);
    if (onRequestSuccess) await onRequestSuccess();
    const finalBody = normalizeFinalBody(adapter, responseBody, body.prompt);

    if (binaryOutput) {
      const binaryResult = await buildBinaryImageResponse(body, finalBody);
      if (binaryResult) return binaryResult;
    }
    return buildJsonImageResponse(finalBody);
  } catch (error: unknown) {
    const errMsg = formatProviderError(error as Error & { code?: string; cause?: { code?: string; message?: string } }, "unknown", model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("IMAGE", `Executor error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }
}

async function retryAfterTokenRefresh(
  adapter: ImageAdapter,
  model: string,
  body: Record<string, unknown>,
  credentials: Record<string, unknown>,
  provider: string,
  executor: { refreshCredentials: (creds: Record<string, unknown>, log: unknown) => Promise<Record<string, unknown>> },
  log: { debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void } | undefined,
  onCredentialsRefreshed?: (creds: Record<string, unknown>) => void | Promise<void>,
): Promise<Response | null> {
  const newCredentials = await refreshWithRetry(
    () => executor.refreshCredentials(credentials, log),
    3,
    log,
  );
  if (!newCredentials?.accessToken && !newCredentials?.apiKey) {
    log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    return null;
  }
  log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for image generation`);
  Object.assign(credentials, newCredentials);
  if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);
  try {
    const retryBody = await adapter.buildBody(model, body);
    const retryHeaders = adapter.buildHeaders(credentials, retryBody, model, body);
    const retryUrl = adapter.buildUrl(model, credentials);
    return fetch(retryUrl, {
      method: "POST",
      headers: retryHeaders,
      body: serializeRequestBody(retryBody),
    });
  } catch {
    log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
    return null;
  }
}

async function executeViaFetch(
  adapter: ImageAdapter,
  model: string,
  body: Record<string, unknown>,
  credentials: Record<string, unknown>,
  provider: string,
  log: { debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void } | undefined,
  binaryOutput: boolean,
  streamToClient: boolean,
  onCredentialsRefreshed?: (creds: Record<string, unknown>) => void | Promise<void>,
  onRequestSuccess?: () => void | Promise<void>,
) {
  let url: string;
  let headers: Record<string, string>;
  let requestBody: unknown;
  try {
    url = adapter.buildUrl(model, credentials);
    requestBody = await adapter.buildBody(model, body);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error: unknown) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, (error as Error).message || `Invalid ${provider} image request`);
  }

  log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${(body.prompt as string).slice(0, 50)}..."`);

  let providerResponse: Response;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: serializeRequestBody(requestBody),
    });
  } catch (error: unknown) {
    const errMsg = formatProviderError(error as Error & { code?: string; cause?: { code?: string; message?: string } }, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("IMAGE", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh (skipped for noAuth providers)
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    !adapter.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const retryResponse = await retryAfterTokenRefresh(
      adapter, model, body, credentials, provider, executor, log, onCredentialsRefreshed,
    );
    if (retryResponse) providerResponse = retryResponse;
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message) as Error & { code?: string; cause?: { code?: string; message?: string } }, provider, model, statusCode);
    log?.debug?.("IMAGE", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  return parseAndNormalizeResponse(
    adapter, providerResponse, headers, log, streamToClient, onRequestSuccess,
    url, requestBody, model, body, provider, binaryOutput,
  );
}

/** Parse provider response and normalize to OpenAI-compatible shape */
async function parseAndNormalizeResponse(
  adapter: ImageAdapter,
  providerResponse: Response,
  headers: Record<string, string>,
  log: { debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void } | undefined,
  streamToClient: boolean,
  onRequestSuccess: (() => void | Promise<void>) | undefined,
  url: string,
  requestBody: unknown,
  model: string,
  body: Record<string, unknown>,
  provider: string,
  binaryOutput: boolean,
) {
  let parsed: unknown;
  try {
    if (adapter.parseResponse) {
      parsed = await adapter.parseResponse(providerResponse, {
        headers, log, streamToClient, onRequestSuccess, url, requestBody, model, body,
      });
      if ((parsed as Record<string, unknown>)?.sseResponse) {
        return { success: true, response: (parsed as Record<string, unknown>).sseResponse as Response };
      }
    } else {
      parsed = await providerResponse.json();
    }
  } catch (parseError: unknown) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, (parseError as Error).message || `Invalid response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const finalBody = normalizeFinalBody(adapter, parsed, body.prompt);

  if (binaryOutput) {
    const binaryResult = await buildBinaryImageResponse(body, finalBody);
    if (binaryResult) return binaryResult;
  }

  return buildJsonImageResponse(finalBody);
}

/**
 * Core image generation handler — orchestrator only.
 * Provider-specific URL/headers/body/parse/normalize live in `./imageProviders/{id}.js`.
 *
 * @param {object} options
 * @param {object} options.body - Request body { model, prompt, n, size, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {boolean} [options.streamToClient] - Pipe SSE to client (codex)
 * @param {boolean} [options.binaryOutput] - Return raw image bytes
 * @param {function} [options.onCredentialsRefreshed]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleImageGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  streamToClient = false,
  binaryOutput = false,
  onCredentialsRefreshed,
  onRequestSuccess,
}: {
  body: Record<string, unknown>;
  modelInfo: { provider: string; model: string };
  credentials: Record<string, unknown>;
  log?: { debug?: (...args: unknown[]) => void; info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void };
  streamToClient?: boolean;
  binaryOutput?: boolean;
  onCredentialsRefreshed?: (creds: Record<string, unknown>) => void | Promise<void>;
  onRequestSuccess?: () => void | Promise<void>;
}) {
  const { provider, model } = modelInfo;

  if (!body.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  }

  const adapter = getImageAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support image generation`
    );
  }

  if (adapter.useExecutor && adapter.executeViaExecutor) {
    return executeViaExecutor(adapter, model, body, credentials, log, binaryOutput, onRequestSuccess);
  }

  return executeViaFetch(
    adapter, model, body, credentials, provider, log,
    binaryOutput, streamToClient, onCredentialsRefreshed, onRequestSuccess,
  );
}
