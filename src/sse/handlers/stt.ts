import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable,
} from "../services/auth";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model";
import { handleSttCore } from "@/lib/open-sse/handlers/sttCore";
import { errorResponse, unavailableResponse } from "@/lib/open-sse/utils/error";
import { HTTP_STATUS } from "@/lib/open-sse/config/runtimeConfig";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import * as log from "../utils/logger";
import { handleComboChat } from "@/lib/open-sse/services/combo";
import { attachRoutingDecision } from "@/lib/open-sse/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/lib/open-sse/services/smart-routing/router";
import { classifySmartRouting } from "../services/smartRoutingClassifier";

const CREDENTIALED_PROVIDERS: Set<string> = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]: [string, Record<string, unknown>]) => (p.serviceKinds as string[] | undefined)?.includes("stt") && !p.noAuth && (p.sttConfig as Record<string, unknown> | undefined)?.authType !== "none")
    .map(([id]: [string, Record<string, unknown>]) => id)
);

export async function handleStt(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }

  const modelStr: string | null = formData.get("model") as string | null;
  log.request("POST", `/v1/audio/transcriptions | ${modelStr}`);

  const settings = await getSettings();
  const apiKey: string | null = extractApiKey(request);
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid: boolean = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!formData.get("file")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  const smartCombo = await getSmartCombo(modelStr);
  if (smartCombo) {
    const routingBody: Record<string, unknown> = {
      model: modelStr,
      prompt: formData.get("prompt") || "Transcribe the supplied audio",
      input_audio: true,
    };
    try {
      const routing = await resolveSmartRouting({
        combo: smartCombo,
        body: routingBody,
        headers: request.headers,
        endpointNeed: "stt",
        sessionKey: deriveRoutingSessionKey(request.headers, routingBody),
        classifyWithModel: (model, prompt, timeoutMs) => classifySmartRouting(model, prompt, timeoutMs, request, apiKey),
      });
      if (routing.models.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No compatible transcription model is active");
      attachRoutingDecision(routingBody, routing.meta);
      log.info("ROUTING", `Smart combo "${modelStr}" → stt/${routing.meta.tier} → ${routing.models[0]}`);
      return handleComboChat({
        body: routingBody,
        models: routing.models,
        handleSingleModel: (_body: Record<string, unknown>, model: string) => {
          const nextForm = new FormData();
          for (const [key, value] of formData.entries()) {
            if (key !== "model") nextForm.append(key, value);
          }
          nextForm.set("model", model);
          const headers = new Headers(request.headers);
          headers.delete("content-type");
          headers.delete("content-length");
          return handleStt(new Request(request.url, { method: request.method, headers, body: nextForm, signal: request.signal }));
        },
        log,
        comboName: modelStr,
        comboStrategy: "fallback",
        autoSwitch: false,
      });
    } catch (error) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, error instanceof Error ? error.message : "Invalid smart routing configuration");
    }
  }

  const modelInfo: { provider: string | null; model: string } = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result: { success: boolean; response: Response; status?: number; error?: string } = await handleSttCore({ provider, model, formData, credentials: null as unknown as Record<string, unknown>, sttConfig: AI_PROVIDERS[provider]?.sttConfig as Record<string, unknown> | null });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "STT failed");
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

    const result: { success: boolean; response: Response; status?: number; error?: string } = await handleSttCore({ provider, model, formData, credentials: credentials as unknown as Record<string, unknown>, sttConfig: AI_PROVIDERS[provider]?.sttConfig as Record<string, unknown> | null });

    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId!, result.status!, result.error!, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId!);
      lastError = result.error!;
      lastStatus = result.status!;
      continue;
    }
    return result.response || errorResponse(result.status ?? HTTP_STATUS.BAD_GATEWAY, result.error ?? "STT failed");
  }
}
