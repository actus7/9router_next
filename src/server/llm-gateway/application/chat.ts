// Patch global fetch with proxy support (must be first)
import "@/server/llm-gateway/engine/utils/proxyFetch";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  type CredentialsResult,
} from "../auth/accountSelection";
import { requireGatewayApiKey } from "./gatewayApiKey";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { getModelInfo, getComboModels, assertModelEnabled } from "./modelResolution";
import { handleChatCore } from "@/server/llm-gateway/engine/handlers/chatCore";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader";
import { appendPxpipeEvent } from "@/lib/pxpipe/events";
import { errorResponse, unavailableResponse } from "@/server/llm-gateway/engine/utils/error";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "@/server/llm-gateway/engine/services/combo";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "@/server/llm-gateway/engine/services/capacityAdapter";
import { handleBypassRequest } from "@/server/llm-gateway/engine/utils/bypassHandler";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import { resolveAccountExhaustion } from "@/server/llm-gateway/engine/services/accountFallback";
import { detectFormatByEndpoint } from "@/server/llm-gateway/engine/translator/formats";
import * as log from "../utils/logger";
import { updateProviderCredentials, checkAndRefreshToken } from "../auth/tokenRefresh";
import { getProjectIdForConnection } from "@/server/llm-gateway/engine/services/projectId";
import { attachRoutingDecision } from "@/server/llm-gateway/engine/services/smart-routing/context";
import {
  recordRoutingStep,
  setRoutingTraceSelection,
  startRoutingTrace,
  withRoutingTraceHeader,
} from "@/server/llm-gateway/engine/services/routingTrace";
import { truncateTraceError } from "@/shared/observability/routingTrace";
import { FREE_DEFAULT_MODEL_KEY, isFreeDefaultProvider } from "@/shared/constants/freeDefault";
import {
  deriveRoutingSessionKey,
  getSmartCombo,
  resolveSmartRouting,
} from "@/server/llm-gateway/engine/services/smart-routing/router";
import { buildClassifierCallback } from "./routingClassifier";
import {
  checkNoAuthCooldownResponse,
  handleNoAuthCooldownResult,
} from "./noAuthCooldown";
import type { ClientRawRequest as CoreClientRawRequest, ProviderThinkingConfig } from "@/server/llm-gateway/engine/handlers/chatCore/types";
import type { RequestBody } from "@/server/llm-gateway/engine/services/types";

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

// ── Routing helpers ─────────────────────────────────────────────────────────

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
      classifyWithModel: buildClassifierCallback(request, apiKey, handleSingleModelChat),
    });
  } catch (error) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, error instanceof Error ? error.message : "Invalid smart routing configuration");
  }
  if (routing.models.length === 0) {
    return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `No compatible active model found for smart combo: ${modelStr}`);
  }
  attachRoutingDecision(body, routing.meta);
  recordRoutingStep(body, {
    kind: "smart",
    name: modelStr,
    need: routing.meta.need,
    tier: routing.meta.tier,
    reason: routing.meta.reason,
    score: routing.meta.score,
    confidence: routing.meta.confidence,
    degraded: routing.meta.degraded,
    classifierModel: routing.meta.classifierModel,
    classifierLatencyMs: routing.meta.classifierLatencyMs,
    candidates: routing.models,
  });
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
  recordRoutingStep(body, { kind: "combo", name: modelStr, strategy: comboStrategy, models: augmentedModels });

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
    ),
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
  recordRoutingStep(body, {
    kind: "adapter",
    requested: modelStr,
    capabilities: [...requiredCapabilities],
    models: soloAugmented,
    strategy: getActiveAdapterStrategy(requiredCapabilities, settings),
  });
  log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
  return handleComboChat({
    body,
    models: soloAugmented,
    handleSingleModel: withCapacityAdapterStripping(
      (b: ChatBody, m: string) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      adapterAdded
    ),
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
  recordRoutingStep(body, { kind: "combo", name: modelStr, strategy: comboStrategy, models: augmentedModels });

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
    ),
    log,
    comboName: modelStr,
    comboStrategy,
    comboStickyLimit
  });
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
      });
    },
    onRequestSuccess: async () => {
      await clearAccountError(connectionId, credentials, model);
    }
  } as Parameters<typeof handleChatCore>[0];
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

  const authError = await requireGatewayApiKey(apiKey);
  if (authError) return authError;

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  const userAgent: string = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, Boolean((await getSettings()).ccFilterNaming));
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // The trace is collected while routing and attached to whatever response wins,
  // so the caller can see the combo, the smart decision and every failed attempt.
  startRoutingTrace(body, modelStr);
  const response = await routeChatRequest(modelStr, body, request, apiKey, clientRawRequest);
  return withRoutingTraceHeader(response, body);
}

/** Pick the routing layer that owns this model and let it answer. */
async function routeChatRequest(
  modelStr: string,
  body: ChatBody,
  request: Request,
  apiKey: string | null,
  clientRawRequest: ClientRawRequest,
): Promise<Response> {
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
 * Last resort when the requested provider has no usable account left: the
 * credential-free default needs no account, so it can still answer instead of
 * the caller getting an error. Reached only after the normal per-connection
 * fallback has exhausted every account for the requested provider, never in
 * place of it.
 */
async function tryFreeFallbackChat(
  provider: string,
  body: ChatBody,
  clientRawRequest: ClientRawRequest | null,
  request: Request | null,
  apiKey: string | null,
): Promise<Response | null> {
  // Already on the free provider: it has nowhere left to fall to.
  if (isFreeDefaultProvider(provider)) return null;
  const settings = await getSettings();
  if (settings.freeFallbackEnabled === false) return null;
  log.warn("CHAT", `[${provider}] no account left, falling back to ${FREE_DEFAULT_MODEL_KEY}`);
  const response = await handleSingleModelChat(
    { ...body, model: FREE_DEFAULT_MODEL_KEY },
    FREE_DEFAULT_MODEL_KEY,
    clientRawRequest,
    request,
    apiKey,
    false,
  );
  // A failing fallback must not stand in for the real error. The caller needs
  // to know why their own provider failed, not why the free one also did, so
  // returning null here hands control back to the original error path.
  return response.ok ? response : null;
}

/**
 * Handle single model chat request
 */
export async function handleSingleModelChat(
  body: ChatBody,
  modelStr: string,
  clientRawRequest: ClientRawRequest | null = null,
  request: Request | null = null,
  apiKey: string | null = null,
  /** False on the free-fallback attempt itself, so it cannot recurse. */
  allowFreeFallback = true
): Promise<Response> {
  const modelInfo: { provider: string | null; model: string } = await getModelInfo(modelStr);

  if (!modelInfo.provider) {
    return resolveComboForModel(modelStr, body, clientRawRequest, request, apiKey);
  }

  const { provider, model } = modelInfo;

  const disabledResponse = await assertModelEnabled(provider, model);
  if (disabledResponse) return disabledResponse;

  const cooldownResponse = await checkNoAuthCooldownResponse(provider, model);
  if (cooldownResponse) return cooldownResponse;

    const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials: CredentialsResult | null = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      recordRoutingStep(body, {
        kind: "account",
        provider,
        model,
        outcome: "exhausted",
        ...(lastStatus ? { status: lastStatus } : {}),
        ...(truncateTraceError(lastError || credentials?.lastError) ? { error: truncateTraceError(lastError || credentials?.lastError) } : {}),
      });
      if (allowFreeFallback) {
        const freeResponse = await tryFreeFallbackChat(provider, body, clientRawRequest, request, apiKey);
        if (freeResponse) return freeResponse;
      }
      // Shared with the embeddings path so the three outcomes cannot drift
      // apart again the way 404-vs-400 did.
      const exhaustion = resolveAccountExhaustion(
        provider, model, credentials, excludeConnectionIds.size, lastError, lastStatus,
      );
      if (exhaustion.kind === "rate-limited") {
        log.warn("CHAT", `${exhaustion.message} (${exhaustion.retryAfterHuman})`);
        return unavailableResponse(exhaustion.status, exhaustion.message, exhaustion.retryAfter, exhaustion.retryAfterHuman);
      }
      log.warn(exhaustion.kind === "no-accounts" ? "AUTH" : "CHAT", exhaustion.message, { provider });
      return errorResponse(exhaustion.status, exhaustion.message);
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

    if (result.success) {
      recordRoutingStep(body, {
        kind: "account",
        provider,
        model,
        outcome: "selected",
        ...(credentials.connectionName ? { connection: String(credentials.connectionName) } : {}),
      });
      setRoutingTraceSelection(body, `${provider}/${model}`);
      return result.response;
    }

    const noAuthResponse = await handleNoAuthCooldownResult(result, provider, model);
    if (noAuthResponse) return noAuthResponse;

    const { shouldFallback } = await markAccountUnavailable(connectionId, result.status, result.error, provider, model, result.resetsAtMs ?? null);

    recordRoutingStep(body, {
      kind: "account",
      provider,
      model,
      outcome: shouldFallback ? "switched" : "failed",
      ...(credentials.connectionName ? { connection: String(credentials.connectionName) } : {}),
      status: result.status,
      ...(truncateTraceError(result.error) ? { error: truncateTraceError(result.error) } : {}),
    });

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
