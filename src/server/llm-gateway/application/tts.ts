import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable,
} from "../auth/accountSelection";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "./modelResolution";
import { handleTtsCore } from "@/server/llm-gateway/engine/handlers/ttsCore";
import { errorResponse, unavailableResponse } from "@/server/llm-gateway/engine/utils/error";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import * as log from "../utils/logger";
import { attachRoutingDecision } from "@/server/llm-gateway/engine/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/server/llm-gateway/engine/services/smart-routing/router";
import { classifySmartRouting } from "./smartRoutingClassifier";

const CREDENTIALED_PROVIDERS: Set<string> = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]: [string, Record<string, unknown>]) => (p.serviceKinds as string[] | undefined)?.includes("tts") && !p.noAuth && (p.ttsConfig as Record<string, unknown> | undefined)?.authType !== "none")
    .map(([id]: [string, Record<string, unknown>]) => id)
);

export async function handleTts(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url: URL = new URL(request.url);
  const modelStr: string | undefined = body.model as string | undefined;
  const responseFormat: string = url.searchParams.get("response_format") || "mp3";
  const language: string = (body.language as string) || "";
  const style: string = (body.style as string) || "";
  log.request("POST", `${url.pathname} | ${modelStr} | format=${responseFormat}${language ? ` | lang=${language}` : ""}`);

  const settings = await getSettings();
  const apiKey: string | null = extractApiKey(request);
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid: boolean = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");

  const smartCombo = await getSmartCombo(modelStr);
  if (smartCombo) {
    try {
      const routing = await resolveSmartRouting({
        combo: smartCombo,
        body,
        headers: request.headers,
        endpointNeed: "tts",
        sessionKey: deriveRoutingSessionKey(request.headers, body),
        classifyWithModel: (model, prompt, timeoutMs) => classifySmartRouting(model, prompt, timeoutMs, request, apiKey),
      });
      if (routing.models.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No compatible TTS model is active");
      attachRoutingDecision(body, routing.meta);
      log.info("ROUTING", `Smart combo "${modelStr}" → tts/${routing.meta.tier} → ${routing.models[0]}`);
      return handleComboChat({
        body,
        models: routing.models,
        handleSingleModel: (b: Record<string, unknown>, m: string) => handleSingleModelTts(b, m, responseFormat, language, style),
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
    const comboStrategy: string = (comboStrategies[modelStr] as Record<string, unknown> | undefined)?.fallbackStrategy as string || (settings as Record<string, unknown>).comboStrategy as string || "fallback";
    const comboStickyLimit: number = (settings as Record<string, unknown>).comboStickyRoundRobinLimit as number;
    log.info("TTS", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b: Record<string, unknown>, m: string) => handleSingleModelTts(b, m, responseFormat, language, style),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingleModelTts(body, modelStr, responseFormat, language, style);
}

async function handleSingleModelTts(body: Record<string, unknown>, modelStr: string, responseFormat: string, language: string, style: string): Promise<Response> {
  const modelInfo: { provider: string | null; model: string } = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("ROUTING", `Provider: ${provider}, Voice: ${model}`);

  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleTtsCore({ provider, model, input: body.input as string, credentials: null as unknown as Record<string, unknown>, responseFormat, language, style }) as Record<string, unknown>;
    if (result.success) return result.response as Response;
    return errorResponse((result.status as number) ?? HTTP_STATUS.BAD_GATEWAY, (result.error as string) ?? "TTS failed");
  }

  const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg: string = lastError || credentials.lastError || "Unavailable";
        const status: number = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, String(credentials.retryAfter ?? ""), credentials.retryAfterHuman ?? "");
      }
      if (excludeConnectionIds.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const result = await handleTtsCore({ provider, model, input: body.input as string, credentials: credentials as unknown as Record<string, unknown>, responseFormat, language, style }) as unknown as Record<string, unknown>;

    if (result.success) return result.response as Response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId!, result.status as number, result.error as string, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId!);
      lastError = result.error as string;
      lastStatus = result.status as number;
      continue;
    }
    return (result.response as Response) || errorResponse((result.status as number) ?? HTTP_STATUS.BAD_GATEWAY, (result.error as string) ?? "TTS failed");
  }
}
