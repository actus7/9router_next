import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  type CredentialsResult,
} from "../auth/accountSelection";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "./modelResolution";
import { handleVideoProxyCore, getVideoConfig, sanitizeSecrets } from "@/lib/open-sse/handlers/videoCore";
import { errorResponse, unavailableResponse } from "@/lib/open-sse/utils/error";
import { HTTP_STATUS } from "@/lib/open-sse/config/runtimeConfig";
import { updateProviderCredentials, checkAndRefreshToken } from "../auth/tokenRefresh";
import * as log from "../utils/logger";
import { handleComboChat } from "@/lib/open-sse/services/combo";
import { attachRoutingDecision } from "@/lib/open-sse/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/lib/open-sse/services/smart-routing/router";
import { classifySmartRouting } from "./smartRoutingClassifier";

const DEFAULT_VIDEO_PROVIDER: string = "xai";

const CREATE_ROTATION_STATUSES: Set<number> = new Set([
  HTTP_STATUS.UNAUTHORIZED,
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.RATE_LIMITED,
]);

async function requireValidApiKey(request: Request): Promise<Response | null> {
  const apiKey: string | null = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid: boolean = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  return null;
}

interface ForwardableBody {
  raw?: string | Buffer;
  parsed?: Record<string, unknown> | null;
  contentType?: string;
  error?: Response;
}

async function readForwardableBody(request: Request): Promise<ForwardableBody> {
  const contentType: string = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const raw: string = await request.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "JSON body must be an object") };
    }
    return { raw, parsed: parsed as Record<string, unknown>, contentType };
  }
  const buf: Buffer = Buffer.from(await request.arrayBuffer());
  return { raw: buf, parsed: null, contentType };
}

interface VideoProviderResult {
  provider?: string;
  model?: string | null;
  error?: Response;
}

type VideoCoreResult =
  | { success: true; response: Response }
  | { success: false; status: number; error: string; response: Response };

async function resolveVideoProvider(parsedBody: Record<string, unknown> | null | undefined): Promise<VideoProviderResult> {
  if (!parsedBody?.model) return { provider: DEFAULT_VIDEO_PROVIDER, model: null };

  const modelStr: string = String(parsedBody.model);
  const modelInfo: { provider: string | null; model: string } = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Combos are not supported for video generation") };
  }
  if (!getVideoConfig(modelInfo.provider)) {
    if (!modelStr.includes("/")) {
      return { provider: DEFAULT_VIDEO_PROVIDER, model: modelStr };
    }
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider '${modelInfo.provider}' does not support video generation`) };
  }
  return { provider: modelInfo.provider, model: modelInfo.model };
}

function withConnectionHeader(response: Response, connectionId: string | null): Response {
  if (!connectionId) return response;
  const headers: Headers = new Headers(response.headers);
  headers.set("x-9router-connection-id", String(connectionId));
  return new Response(response.body, { status: response.status, headers });
}

/**
 * POST /v1/videos/{generations|edits|extensions} â€” async job creation proxy.
 */
export async function handleVideoCreate(request: Request, action: string): Promise<Response> {
  const authError: Response | null = await requireValidApiKey(request);
  if (authError) return authError;
  const apiKey: string | null = extractApiKey(request);

  const bodyInfo: ForwardableBody = await readForwardableBody(request);
  if (bodyInfo.error) return bodyInfo.error;
  const parsedBody: Record<string, unknown> = bodyInfo.parsed ?? {};

  const requestedModel = typeof parsedBody.model === "string" ? parsedBody.model : "";
  const smartCombo = await getSmartCombo(requestedModel);
  if (smartCombo) {
    try {
      const routing = await resolveSmartRouting({
        combo: smartCombo,
        body: parsedBody,
        headers: request.headers,
        endpointNeed: "video_generation",
        sessionKey: deriveRoutingSessionKey(request.headers, parsedBody),
        classifyWithModel: (classifierModel, prompt, timeoutMs) => classifySmartRouting(classifierModel, prompt, timeoutMs, request, apiKey),
      });
      if (routing.models.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No compatible video model is active");
      attachRoutingDecision(parsedBody, routing.meta);
      log.info("ROUTING", `Smart combo "${requestedModel}" â†’ video_generation/${routing.meta.tier} â†’ ${routing.models[0]}`);
      return handleComboChat({
        body: parsedBody,
        models: routing.models,
        handleSingleModel: (body: Record<string, unknown>, model: string) => handleVideoCreate(new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify({ ...body, model }),
          signal: request.signal,
        }), action),
        log,
        comboName: requestedModel,
        comboStrategy: "fallback",
        autoSwitch: false,
      });
    } catch (error) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, error instanceof Error ? error.message : "Invalid smart routing configuration");
    }
  }

  const resolved: VideoProviderResult = await resolveVideoProvider(parsedBody);
  if (resolved.error) return resolved.error;
  const { provider, model } = resolved;
  if (!provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Unable to resolve video provider");

  let forwardBody: string | Buffer = bodyInfo.raw!;
  if (bodyInfo.parsed && model && parsedBody.model !== model) {
    forwardBody = JSON.stringify({ ...parsedBody, model });
  }

  const preferredConnectionId: string | null = request.headers.get("x-connection-id") || null;
  const idempotencyKey: string | null = request.headers.get("idempotency-key") || null;

  const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials: CredentialsResult | null = await getProviderCredentials(provider!, excludeConnectionIds, model || null, { preferredConnectionId: preferredConnectionId || undefined });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg: string = lastError || credentials.lastError || "Unavailable";
        const status: number = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model || "video"}] ${errorMsg}`, String(credentials.retryAfter ?? ""), credentials.retryAfterHuman ?? "");
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    if (!credentials.connectionId) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${provider} returned credentials without an identifier`);
    }
    const connectionId = credentials.connectionId;
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials) as CredentialsResult;

    const result = await handleVideoProxyCore({
      provider,
      action,
      rawBody: forwardBody,
      contentType: bodyInfo.contentType || null,
      idempotencyKey,
      credentials: refreshedCredentials,
      signal: request.signal,
      log,
      onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
        await updateProviderCredentials(connectionId, {
          accessToken: typeof newCreds.accessToken === "string" ? newCreds.accessToken : undefined,
          refreshToken: typeof newCreds.refreshToken === "string" ? newCreds.refreshToken : undefined,
          providerSpecificData: newCreds.providerSpecificData as Record<string, unknown> | undefined,
          testStatus: "active",
        });
      },
    } as unknown as Parameters<typeof handleVideoProxyCore>[0]) as VideoCoreResult;

    if (result.success) {
      await clearAccountError(connectionId, credentials, model || null);
      log.info("VIDEO", `${provider.toUpperCase()} | ${action} accepted (connection ${connectionId})`);
      return withConnectionHeader(result.response, connectionId);
    }

    const { shouldFallback } = await markAccountUnavailable(
      connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, model || null
    );

    if (shouldFallback && CREATE_ROTATION_STATUSES.has(result.status)) {
      excludeConnectionIds.add(connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

/**
 * GET /v1/videos/{request_id} â€” poll job status.
 */
export async function handleVideoGet(request: Request, requestId: string): Promise<Response> {
  const authError: Response | null = await requireValidApiKey(request);
  if (authError) return authError;

  if (!requestId) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing video request id");

  const provider: string = DEFAULT_VIDEO_PROVIDER;
  const preferredConnectionId: string | null = request.headers.get("x-connection-id") || null;

  const credentials: CredentialsResult | null = await getProviderCredentials(provider, null, null, { preferredConnectionId: preferredConnectionId || undefined });
  if (!credentials || credentials.allRateLimited) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
  }
  if (!credentials.connectionId) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${provider} returned credentials without an identifier`);
  }
  const connectionId = credentials.connectionId;

  const refreshedCredentials = await checkAndRefreshToken(provider, credentials) as CredentialsResult;

  const result = await handleVideoProxyCore({
    provider,
    requestId,
    credentials: refreshedCredentials,
    signal: request.signal,
    log,
    onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
      await updateProviderCredentials(connectionId, {
        accessToken: typeof newCreds.accessToken === "string" ? newCreds.accessToken : undefined,
        refreshToken: typeof newCreds.refreshToken === "string" ? newCreds.refreshToken : undefined,
        providerSpecificData: newCreds.providerSpecificData as Record<string, unknown> | undefined,
        testStatus: "active",
      });
    },
  } as unknown as Parameters<typeof handleVideoProxyCore>[0]) as VideoCoreResult;

  if (result.success) {
    await clearAccountError(connectionId, credentials, null);
    return withConnectionHeader(result.response, connectionId);
  }

  await markAccountUnavailable(
    connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, null
  );
  return result.response;
}
