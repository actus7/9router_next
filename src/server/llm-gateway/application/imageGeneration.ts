import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../auth/accountSelection";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "./modelResolution";
import { handleImageGenerationCore } from "@/lib/open-sse/handlers/imageGenerationCore";
import { errorResponse, unavailableResponse } from "@/lib/open-sse/utils/error";
import { HTTP_STATUS } from "@/lib/open-sse/config/runtimeConfig";
import { updateProviderCredentials, checkAndRefreshToken } from "../auth/tokenRefresh";
import { handleComboChat } from "@/lib/open-sse/services/combo";
import * as log from "../utils/logger";
import { attachRoutingDecision } from "@/lib/open-sse/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/lib/open-sse/services/smart-routing/router";
import { classifySmartRouting } from "./smartRoutingClassifier";

const NO_AUTH_PROVIDERS: Set<string> = new Set(["sdwebui", "comfyui"]);

interface ImageOptions {
  wantsStream?: boolean;
  binaryOutput?: boolean;
  preferredConnectionId?: string | null;
}

/**
 * Handle image generation request
 */
export async function handleImageGeneration(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url: URL = new URL(request.url);
  const preferredConnectionId: string | null = request.headers.get("x-connection-id") || null;
  const wantsStream: boolean = (request.headers.get("accept") || "").includes("text/event-stream");
  const binaryOutput: boolean = url.searchParams.get("response_format") === "binary";
  const modelStr: string | undefined = body.model as string | undefined;

  const apiKey: string | null = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid: boolean = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  const smartCombo = await getSmartCombo(modelStr);
  if (smartCombo) {
    try {
      const routing = await resolveSmartRouting({
        combo: smartCombo,
        body,
        headers: request.headers,
        endpointNeed: "image_generation",
        sessionKey: deriveRoutingSessionKey(request.headers, body),
        classifyWithModel: (model, prompt, timeoutMs) => classifySmartRouting(model, prompt, timeoutMs, request, apiKey),
      });
      if (routing.models.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No compatible image model is active");
      attachRoutingDecision(body, routing.meta);
      log.info("ROUTING", `Smart combo "${modelStr}" â†’ image_generation/${routing.meta.tier} â†’ ${routing.models[0]}`);
      return handleComboChat({
        body,
        models: routing.models,
        handleSingleModel: (b: Record<string, unknown>, m: string) => handleSingleModelImage(b, m, { wantsStream, binaryOutput, preferredConnectionId }),
        log,
        comboName: modelStr,
        comboStrategy: "fallback",
        autoSwitch: false,
      });
    } catch (error) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, error instanceof Error ? error.message : "Invalid smart routing configuration");
    }
  }

  const comboModels: string[] | null = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies: Record<string, unknown> = (settings as Record<string, unknown>).comboStrategies as Record<string, unknown> || {};
    const comboStrategy: string = ((comboStrategies[modelStr] as Record<string, unknown> | undefined)?.fallbackStrategy as string) || (settings as Record<string, unknown>).comboStrategy as string || "fallback";
    const comboStickyLimit: number = (settings as Record<string, unknown>).comboStickyRoundRobinLimit as number;
    log.info("IMAGE", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b: Record<string, unknown>, m: string) => handleSingleModelImage(b, m, { wantsStream, binaryOutput, preferredConnectionId }),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingleModelImage(body, modelStr, { wantsStream, binaryOutput, preferredConnectionId });
}

async function handleSingleModelImage(body: Record<string, unknown>, modelStr: string, { wantsStream, binaryOutput, preferredConnectionId }: ImageOptions = {}): Promise<Response> {
  const modelInfo: { provider: string | null; model: string } = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;

  if (NO_AUTH_PROVIDERS.has(provider)) {
    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: null as unknown as Record<string, unknown>,
      log: log as unknown as Parameters<typeof handleImageGenerationCore>[0]["log"],
      binaryOutput,
      onCredentialsRefreshed: async () => {},
      onRequestSuccess: async () => {},
    } as unknown as Parameters<typeof handleImageGenerationCore>[0]) as unknown as Record<string, unknown>;
    if (result.success) return result.response as Response;
    return errorResponse((result.status as number) || HTTP_STATUS.BAD_GATEWAY, (result.error as string) || "Image generation failed");
  }

  const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId: preferredConnectionId || undefined });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg: string = lastError || credentials.lastError || "Unavailable";
        const status: number = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, String(credentials.retryAfter ?? ""), credentials.retryAfterHuman ?? "");
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials as unknown as Record<string, unknown>,
      log,
      streamToClient: wantsStream,
      binaryOutput,
      onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
        await updateProviderCredentials(credentials.connectionId!, {
          accessToken: newCreds.accessToken as string | undefined,
          refreshToken: newCreds.refreshToken as string | undefined,
          providerSpecificData: newCreds.providerSpecificData as Record<string, unknown> | undefined,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId!, credentials, model);
      }
    } as Parameters<typeof handleImageGenerationCore>[0]) as unknown as Record<string, unknown>;

    if (result.success) return result.response as Response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId!, result.status as number, result.error as string, provider, model);

    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId!);
      lastError = result.error as string;
      lastStatus = result.status as number;
      continue;
    }

    return result.response as Response;
  }
}
