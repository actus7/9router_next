import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model";
import { handleVideoProxyCore, getVideoConfig, sanitizeSecrets } from "@/lib/open-sse/handlers/videoCore";
import { errorResponse, unavailableResponse } from "@/lib/open-sse/utils/error";
import { HTTP_STATUS } from "@/lib/open-sse/config/runtimeConfig";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh";
import * as log from "../utils/logger";

const DEFAULT_VIDEO_PROVIDER: string = "xai";

const CREATE_ROTATION_STATUSES: Set<number> = new Set([
  HTTP_STATUS.UNAUTHORIZED,
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.RATE_LIMITED,
]);

async function requireValidApiKey(request: Request): Promise<Response | null> {
  const apiKey: string | null = extractApiKey(request);
  const settings: any = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid: boolean = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  return null;
}

interface ForwardableBody {
  raw?: string | Buffer;
  parsed?: any;
  contentType?: string;
  error?: Response;
}

async function readForwardableBody(request: Request): Promise<ForwardableBody> {
  const contentType: string = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const raw: string = await request.text();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
    }
    return { raw, parsed, contentType };
  }
  const buf: Buffer = Buffer.from(await request.arrayBuffer());
  return { raw: buf, parsed: null, contentType };
}

interface VideoProviderResult {
  provider?: string;
  model?: string | null;
  error?: Response;
}

async function resolveVideoProvider(parsedBody: any): Promise<VideoProviderResult> {
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
 * POST /v1/videos/{generations|edits|extensions} — async job creation proxy.
 */
export async function handleVideoCreate(request: Request, action: string): Promise<Response> {
  const authError: Response | null = await requireValidApiKey(request);
  if (authError) return authError;

  const bodyInfo: ForwardableBody = await readForwardableBody(request);
  if (bodyInfo.error) return bodyInfo.error;

  const resolved: VideoProviderResult = await resolveVideoProvider(bodyInfo.parsed);
  if (resolved.error) return resolved.error;
  const { provider, model } = resolved;

  let forwardBody: string | Buffer = bodyInfo.raw!;
  if (bodyInfo.parsed && model && bodyInfo.parsed.model !== model) {
    forwardBody = JSON.stringify({ ...bodyInfo.parsed, model });
  }

  const preferredConnectionId: string | null = request.headers.get("x-connection-id") || null;
  const idempotencyKey: string | null = request.headers.get("idempotency-key") || null;

  const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials: any = await getProviderCredentials(provider!, excludeConnectionIds, model || null, { preferredConnectionId: preferredConnectionId || undefined });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg: string = lastError || credentials.lastError || "Unavailable";
        const status: number = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model || "video"}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshedCredentials: any = await checkAndRefreshToken(provider!, credentials);

    const result: any = await handleVideoProxyCore({
      provider,
      action,
      rawBody: forwardBody,
      contentType: bodyInfo.contentType || null,
      idempotencyKey,
      credentials: refreshedCredentials,
      signal: request.signal,
      log,
      onCredentialsRefreshed: async (newCreds: any) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      },
    });

    if (result.success) {
      await clearAccountError(credentials.connectionId, credentials, model || null);
      log.info("VIDEO", `${provider!.toUpperCase()} | ${action} accepted (connection ${credentials.connectionId})`);
      return withConnectionHeader(result.response, credentials.connectionId);
    }

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider!, model || null
    );

    if (shouldFallback && CREATE_ROTATION_STATUSES.has(result.status)) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

/**
 * GET /v1/videos/{request_id} — poll job status.
 */
export async function handleVideoGet(request: Request, requestId: string): Promise<Response> {
  const authError: Response | null = await requireValidApiKey(request);
  if (authError) return authError;

  if (!requestId) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing video request id");

  const provider: string = DEFAULT_VIDEO_PROVIDER;
  const preferredConnectionId: string | null = request.headers.get("x-connection-id") || null;

  const credentials: any = await getProviderCredentials(provider, null, null, { preferredConnectionId: preferredConnectionId || undefined });
  if (!credentials || credentials.allRateLimited) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
  }

  const refreshedCredentials: any = await checkAndRefreshToken(provider, credentials);

  const result: any = await handleVideoProxyCore({
    provider,
    requestId,
    credentials: refreshedCredentials,
    signal: request.signal,
    log,
    onCredentialsRefreshed: async (newCreds: any) => {
      await updateProviderCredentials(credentials.connectionId, {
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken,
        providerSpecificData: newCreds.providerSpecificData,
        testStatus: "active",
      });
    },
  });

  if (result.success) {
    await clearAccountError(credentials.connectionId, credentials, null);
    return withConnectionHeader(result.response, credentials.connectionId);
  }

  await markAccountUnavailable(
    credentials.connectionId, result.status, sanitizeSecrets(result.error, refreshedCredentials), provider, null
  );
  return result.response;
}
