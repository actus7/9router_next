// Patch global fetch with proxy support (must be first)
import "@/server/llm-gateway/engine/utils/proxyFetch";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  type CredentialsResult,
} from "../auth/accountSelection";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { getModelInfo, getComboModels } from "./modelResolution";
import { handleChatCore } from "@/server/llm-gateway/engine/handlers/chatCore";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader";
import { appendPxpipeEvent } from "@/lib/pxpipe/events";
import { errorResponse, unavailableResponse } from "@/server/llm-gateway/engine/utils/error";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "@/server/llm-gateway/engine/services/combo";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "@/server/llm-gateway/engine/services/capacityAdapter";
import { handleBypassRequest } from "@/server/llm-gateway/engine/utils/bypassHandler";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import { detectFormatByEndpoint } from "@/server/llm-gateway/engine/translator/formats";
import * as log from "../utils/logger";
import { updateProviderCredentials, checkAndRefreshToken } from "../auth/tokenRefresh";
import { getProjectIdForConnection } from "@/server/llm-gateway/engine/services/projectId";
import { attachRoutingDecision } from "@/server/llm-gateway/engine/services/smart-routing/context";
import {
  deriveRoutingSessionKey,
  getSmartCombo,
  resolveSmartRouting,
  type LlmRoutingClassification,
} from "@/server/llm-gateway/engine/services/smart-routing/router";
import type { ClientRawRequest as CoreClientRawRequest, ProviderThinkingConfig } from "@/server/llm-gateway/engine/handlers/chatCore/types";
import type { RequestBody } from "@/server/llm-gateway/engine/services/types";

// Server-side cooldown for noAuth providers to prevent rapid-fire retries
const noAuthCooldowns = new Map<string, number>();

function isNoAuthOnCooldown(provider: string): number {
  const until = noAuthCooldowns.get(provider);
  if (!until) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    noAuthCooldowns.delete(provider);
    return 0;
  }
  return remaining;
}

function setNoAuthCooldown(provider: string, ms: number): void {
  noAuthCooldowns.set(provider, Date.now() + ms);
}

type ChatBody = RequestBody;
type ClientRawRequest = CoreClientRawRequest;

type ChatResult =
  | { success: true; response: Response }
  | { success: false; response: Response; status: number; error: string; resetsAtMs?: number };

interface ComboStrategyConfig {
  fallbackStrategy?: string;
  judgeModel?: string;
  fusionTuning?: Parameters<typeof handleFusionChat>[0]["tuning"];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractClassifierText(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return "";

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const choiceMessage = asRecord(firstChoice?.message);
  if (typeof choiceMessage?.content === "string") return choiceMessage.content;

  const content = Array.isArray(root.content) ? root.content : [];
  const firstContent = asRecord(content[0]);
  if (typeof firstContent?.text === "string") return firstContent.text;

  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const itemContent = Array.isArray(itemRecord?.content) ? itemRecord.content : [];
    const textPart = itemContent.map(asRecord).find((part) => typeof part?.text === "string");
    if (typeof textPart?.text === "string") return textPart.text;
  }

  return typeof root.response === "string" ? root.response : "";
}

function parseRoutingClassification(payload: unknown): LlmRoutingClassification | null {
  const raw = extractClassifierText(payload);
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const value = asRecord(JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")));
    if (!value || typeof value.tier !== "string" || !["simple", "standard", "complex", "reasoning"].includes(value.tier)) return null;
    return { tier: value.tier, need: value.need } as LlmRoutingClassification;
  } catch {
    return null;
  }
}

// ── Validation helpers ──────────────────────────────────────────────────────

/** Validate API key if required by settings. Returns error Response or null. */
async function validateApiKey(
  request: Request,
  apiKey: string | null,
): Promise<Response | null> {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;
  if (!apiKey) {
    log.warn("AUTH", "Missing API key (requireApiKey=true)");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
  }
  const valid = await isValidApiKey(apiKey);
  if (!valid) {
    log.warn("AUTH", "Invalid API key (requireApiKey=true)");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  return null;
}

// ── Routing helpers ─────────────────────────────────────────────────────────

/** Build classifyWithModel callback for smart routing */
function buildClassifierCallback(
  request: Request,
  apiKey: string | null,
  _clientRawRequest: ClientRawRequest,
) {
  return async (classifierModel: string, prompt: string, timeoutMs: number) => {
    const classifierBody: ChatBody = {
      model: classifierModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 120,
      stream: false,
    };
    const classifierRaw: ClientRawRequest = {
      endpoint: "/v1/chat/completions",
      body: classifierBody,
      headers: { accept: "application/json", "x-router-internal": "classifier" },
    };
    const responsePromise = handleSingleModelChat(classifierBody, classifierModel, classifierRaw, request, apiKey);
    const response = await Promise.race([
      responsePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!response || !response.ok) return null;
    return parseRoutingClassification(await response.json());
  };
}

/** Try smart combo routing. Returns Response if matched, null otherwise. */
async function trySmartComboRouting(
  modelStr: string,
  body: ChatBody,
  request: Request,
  apiKey: string | null,
  clientRawRequest: ClientRawRequest,
): Promise<Response | null> {
  const smartCombo = await getSmartCombo(modelStr);
  if (!smartCombo) return null;

  let routing;
  try {
    routing = await resolveSmartRouting({
      combo: smartCombo,
      body,
      headers: request.headers,
      endpointNeed: "general",
      sessionKey: deriveRoutingSessionKey(request.headers, body),
      classifyWithModel: buildClassifierCallback(request, apiKey, clientRawRequest),
    });
  } catch (error) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, error instanceof Error ? error.message : "Invalid smart routing configuration");
  }
  if (routing.models.length === 0) {
    return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `No compatible active model found for smart combo: ${modelStr}`);
  }
  attachRoutingDecision(body, routing.meta);
  log.info("ROUTING", `Smart combo "${modelStr}" → ${routing.meta.need}/${routing.meta.tier} → ${routing.models[0]}`);
  return handleComboChat({
    body,
    models: routing.models,
    handleSingleModel: (b: ChatBody, m: string) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
    log,
    comboName: modelStr,
    comboStrategy: "fallback",
    autoSwitch: false,
  });
}

/** Build fusion handleSingleModel wrapper */
function buildFusionHandler(
  clientRawRequest: ClientRawRequest,
  request: Request,
  apiKey: string | null,
) {
  return (b: ChatBody, m: string, isPanel?: boolean) => {
    let cleanRawReq: ClientRawRequest | null = clientRawRequest;
    if (isPanel && clientRawRequest) {
      const cleanBody = Object.fromEntries(
        Object.entries(clientRawRequest.body || {}).filter(([key]) => key !== "tools" && key !== "tool_choice")
      );
      cleanRawReq = { ...clientRawRequest, body: cleanBody };
    }
    return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
  };
}

/** Try combo models routing. Returns Response if matched, null otherwise. */
async function tryComboRouting(
  modelStr: string,
  body: ChatBody,
  settings: Record<string, unknown>,
  request: Request,
  apiKey: string | null,
  clientRawRequest: ClientRawRequest,
  requiredCapabilities: Set<string>,
): Promise<Response | null> {
  const comboModels = await getComboModels(modelStr);
  if (!comboModels) return null;

  const comboStrategies = settings.comboStrategies as Record<string, ComboStrategyConfig>;
  const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
  const comboStrategy: string = comboSpecificStrategy || (settings.comboStrategy as string) || "fallback";
  const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
  const adapterAdded = augmentedModels.filter((m: string) => !comboModels.includes(m));

  if (comboStrategy === "fusion") {
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
    return handleFusionChat({
      body,
      models: comboModels,
      handleSingleModel: buildFusionHandler(clientRawRequest, request, apiKey),
      log,
      comboName: modelStr,
      judgeModel: comboStrategies[modelStr]?.judgeModel,
      tuning: comboStrategies[modelStr]?.fusionTuning,
    });
  }

  const comboStickyLimit: number = settings.comboStickyRoundRobinLimit as number;
  log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
  return handleComboChat({
    body,
    models: augmentedModels,
    handleSingleModel: withCapacityAdapterStripping(
      (b: ChatBody, m: string) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      adapterAdded
    ) as unknown as (body: Record<string, unknown>, modelStr: string) => Promise<Response>,
    log,
    comboName: modelStr,
    comboStrategy,
    comboStickyLimit
  });
}

/** Try capacity adapter routing for solo models. Returns Response if matched, null otherwise. */
async function tryCapacityAdapterRouting(
  modelStr: string,
  body: ChatBody,
  settings: Record<string, unknown>,
  request: Request,
  apiKey: string | null,
  clientRawRequest: ClientRawRequest,
  requiredCapabilities: Set<string>,
): Promise<Response | null> {
  const soloAugmented = augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
  if (soloAugmented.length <= 1) return null;

  const adapterAdded = soloAugmented.filter((m: string) => m !== modelStr);
  log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
  return handleComboChat({
    body,
    models: soloAugmented,
    handleSingleModel: withCapacityAdapterStripping(
      (b: ChatBody, m: string) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      adapterAdded
    ) as unknown as (body: Record<string, unknown>, modelStr: string) => Promise<Response>,
    log,
    comboName: modelStr,
    comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
  });
}

// ── Single model helpers ────────────────────────────────────────────────────

/** Resolve combo when modelInfo has no provider. Returns Response or throws. */
async function resolveComboForModel(
  modelStr: string,
  body: ChatBody,
  clientRawRequest: ClientRawRequest | null,
  request: Request | null,
  apiKey: string | null,
): Promise<Response> {
  const comboModels = await getComboModels(modelStr);
  if (!comboModels) {
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const chatSettings = await getSettings();
  const comboStrategies = chatSettings.comboStrategies as Record<string, ComboStrategyConfig>;
  const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
  const comboStrategy: string = comboSpecificStrategy || (chatSettings.comboStrategy as string) || "fallback";
  const requiredCapabilities = detectRequiredCapabilities(body) as Set<string>;
  const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
  const adapterAdded = augmentedModels.filter((m: string) => !comboModels.includes(m));

  if (comboStrategy === "fusion") {
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
    return handleFusionChat({
      body,
      models: comboModels,
      handleSingleModel: (b: ChatBody, m: string, isPanel?: boolean) => {
        let cleanRawReq: ClientRawRequest | null = clientRawRequest;
        if (isPanel && clientRawRequest) {
          const cleanBody = Object.fromEntries(
            Object.entries(clientRawRequest.body || {}).filter(([key]) => key !== "tools" && key !== "tool_choice")
          );
          cleanRawReq = { ...clientRawRequest, body: cleanBody };
        }
        return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
      },
      log,
      comboName: modelStr,
      judgeModel: comboStrategies[modelStr]?.judgeModel,
      tuning: comboStrategies[modelStr]?.fusionTuning,
    });
  }

  const comboStickyLimit: number = chatSettings.comboStickyRoundRobinLimit;
  log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
  return handleComboChat({
    body,
    models: augmentedModels,
    handleSingleModel: withCapacityAdapterStripping(
      (b: ChatBody, m: string) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      adapterAdded
    ) as unknown as (body: Record<string, unknown>, modelStr: string) => Promise<Response>,
    log,
    comboName: modelStr,
    comboStrategy,
    comboStickyLimit
  });
}

/** Check noAuth cooldown. Returns error Response or null. */
function checkNoAuthCooldownResponse(provider: string, model: string): Response | null {
  const cooldownRemaining = isNoAuthOnCooldown(provider);
  if (cooldownRemaining <= 0) return null;
  const retryAfterSec = Math.ceil(cooldownRemaining / 1000);
  log.warn("CHAT", `[${provider}/${model}] Server-side cooldown active (${retryAfterSec}s remaining)`);
  return new Response(
    JSON.stringify({ error: { message: `[${provider}/${model}] Rate limited. Retry after ${retryAfterSec}s`, type: "rate_limit_error", code: "rate_limit_exceeded" } }),
    {
      status: HTTP_STATUS.RATE_LIMITED,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "Access-Control-Allow-Origin": "*",
      }
    }
  );
}

/** Build the full options object for handleChatCore */
async function buildChatCoreOptions(
  body: ChatBody,
  provider: string,
  model: string,
  refreshedCredentials: CredentialsResult,
  connectionId: string,
  credentials: CredentialsResult,
  clientRawRequest: ClientRawRequest | null,
  request: Request | null,
  apiKey: string | null,
) {
  const chatSettings = await getSettings();
  const providerThinkingById = chatSettings.providerThinking as Record<string, ProviderThinkingConfig> | undefined;
  const providerThinking = providerThinkingById?.[provider] ?? null;
  return {
    body: { ...body, model: `${provider}/${model}` },
    modelInfo: { provider, model },
    credentials: refreshedCredentials,
    log: log as unknown as Parameters<typeof handleChatCore>[0]["log"],
    clientRawRequest: clientRawRequest ?? undefined,
    connectionId,
    userAgent: request?.headers?.get("user-agent") || "",
    apiKey: apiKey ?? undefined,
    ccFilterNaming: !!chatSettings.ccFilterNaming,
    rtkEnabled: !!chatSettings.rtkEnabled,
    headroomEnabled: !!chatSettings.headroomEnabled,
    headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
    headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
    cavemanEnabled: !!chatSettings.cavemanEnabled,
    cavemanLevel: chatSettings.cavemanLevel || "full",
    ponytailEnabled: !!chatSettings.ponytailEnabled,
    ponytailLevel: chatSettings.ponytailLevel || "full",
    synapseEnabled: !!chatSettings.synapseEnabled,
    synapseLevel: chatSettings.synapseLevel || "lite",
    pxpipeEnabled: !!chatSettings.pxpipeEnabled,
    pxpipeMinChars: chatSettings.pxpipeMinChars,
    pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
    pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
    onPxpipeEvent: appendPxpipeEvent,
    providerThinking,
    sourceFormatOverride: request?.url ? (detectFormatByEndpoint(new URL(request.url).pathname, body) ?? undefined) : undefined,
    onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
      await updateProviderCredentials(connectionId, {
        ...newCreds,
        existingProviderSpecificData: credentials.providerSpecificData,
        testStatus: "active"
      });
    },
    onRequestSuccess: async () => {
      await clearAccountError(connectionId, credentials, model);
    }
  } as Parameters<typeof handleChatCore>[0];
}

/** Handle noAuth cooldown on rate-limit/billing errors. Returns Response or null. */
function handleNoAuthCooldownResult(
  result: ChatResult,
  provider: string,
  model: string,
): Response | null {
  if (!("status" in result) || (result.status !== 429 && result.status !== 402)) return null;
  const cooldownMs = result.status === 429 ? 15000 : 30000;
  setNoAuthCooldown(provider, cooldownMs);
  const retryAfterSec = Math.ceil(cooldownMs / 1000);
  log.warn("CHAT", `[${provider}/${model}] noAuth cooldown set (${retryAfterSec}s) after ${result.status}`);
  return new Response(
    JSON.stringify({ error: { message: `[${provider}/${model}] ${result.error}. Retry after ${retryAfterSec}s`, type: result.status === 429 ? "rate_limit_error" : "billing_error", code: result.status === 429 ? "rate_limit_exceeded" : "payment_required" } }),
    {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "Access-Control-Allow-Origin": "*",
      }
    }
  );
}

/**
 * Handle chat completion request
 */
export async function handleChat(request: Request, clientRawRequest: ClientRawRequest | null = null): Promise<Response> {
  let body: ChatBody;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  if (!clientRawRequest) {
    const url: URL = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  const modelStr: string | undefined = body.model;

  const authHeader: string | null = request.headers.get("Authorization");
  const apiKey: string | null = extractApiKey(request);
  if (authHeader && apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  const authError = await validateApiKey(request, apiKey);
  if (authError) return authError;

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  const userAgent: string = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, Boolean((await getSettings()).ccFilterNaming));
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body) as Set<string>;

  const smartComboResponse = await trySmartComboRouting(modelStr, body, request, apiKey, clientRawRequest);
  if (smartComboResponse) return smartComboResponse;

  const settings = await getSettings();
  const comboResponse = await tryComboRouting(modelStr, body, settings, request, apiKey, clientRawRequest, requiredCapabilities);
  if (comboResponse) return comboResponse;

  const capacityResponse = await tryCapacityAdapterRouting(modelStr, body, settings, request, apiKey, clientRawRequest, requiredCapabilities);
  if (capacityResponse) return capacityResponse;

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
export async function handleSingleModelChat(
  body: ChatBody,
  modelStr: string,
  clientRawRequest: ClientRawRequest | null = null,
  request: Request | null = null,
  apiKey: string | null = null
): Promise<Response> {
  const modelInfo: { provider: string | null; model: string } = await getModelInfo(modelStr);

  if (!modelInfo.provider) {
    return resolveComboForModel(modelStr, body, clientRawRequest, request, apiKey);
  }

  const { provider, model } = modelInfo;

  const cooldownResponse = checkNoAuthCooldownResponse(provider, model);
  if (cooldownResponse) return cooldownResponse;

    const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials: CredentialsResult | null = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg: string = lastError || credentials.lastError || "Unavailable";
        const status: number = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, String(credentials.retryAfter ?? ""), credentials.retryAfterHuman ?? "");
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const connectionId: string = credentials.connectionId || "";
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials) as CredentialsResult;

    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId && refreshedCredentials.accessToken) {
      const pid: string | null = await getProjectIdForConnection(connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        updateProviderCredentials(connectionId, { projectId: pid }).catch(() => { });
      }
    }

    const coreOptions = await buildChatCoreOptions(
      body, provider, model, refreshedCredentials, connectionId, credentials, clientRawRequest, request, apiKey,
    );
    const result = await handleChatCore(coreOptions) as ChatResult;

    if (result.success) return result.response;

    const noAuthResponse = handleNoAuthCooldownResult(result, provider, model);
    if (noAuthResponse) return noAuthResponse;

    const { shouldFallback } = await markAccountUnavailable(connectionId, result.status, result.error, provider, model, result.resetsAtMs ?? null);

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
