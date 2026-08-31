import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../auth/accountSelection";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { getCombos } from "@/lib/db/repos/combosRepo";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import { handleSearchCore } from "@/server/llm-gateway/engine/handlers/search/index";
import { errorResponse, unavailableResponse } from "@/server/llm-gateway/engine/utils/error";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import * as log from "../utils/logger";
import { updateProviderCredentials, checkAndRefreshToken } from "../auth/tokenRefresh";
import { handleComboChat, getComboModelsFromData } from "@/server/llm-gateway/engine/services/combo";
import { attachRoutingDecision } from "@/server/llm-gateway/engine/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/server/llm-gateway/engine/services/smart-routing/router";
import { classifySmartRouting } from "./smartRoutingClassifier";

/**
 * Handle web search request for the SSE/Next.js server.
 */
export async function handleSearch(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    log.warn("SEARCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url: URL = new URL(request.url);
  const providerInput: string = (body.provider || body.model) as string;
  const query: string = body.query as string;

  log.request("POST", `${url.pathname} | ${providerInput}`);

  const apiKey: string | null = extractApiKey(request);
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid: boolean = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!providerInput || typeof providerInput !== "string") {
    log.warn("SEARCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }

  if (!query || typeof query !== "string" || !query.trim()) {
    log.warn("SEARCH", "Missing query");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  }

  const smartCombo = await getSmartCombo(providerInput);
  if (smartCombo) {
    try {
      const routing = await resolveSmartRouting({
        combo: smartCombo,
        body,
        headers: request.headers,
        endpointNeed: "web_search",
        sessionKey: deriveRoutingSessionKey(request.headers, body),
        classifyWithModel: (model, prompt, timeoutMs) => classifySmartRouting(model, prompt, timeoutMs, request, apiKey),
      });
      const providers = [...new Set(routing.models.map((candidate) => candidate.split("/", 1)[0]).filter(Boolean))];
      if (providers.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No compatible web search provider is active");
      attachRoutingDecision(body, routing.meta);
      log.info("ROUTING", `Smart combo "${providerInput}" → web_search/${routing.meta.tier} → ${providers[0]}`);
      return handleComboChat({
        body,
        models: providers,
        handleSingleModel: (b: Record<string, unknown>, provider: string) => handleSingleProviderSearch(b, provider, request, apiKey, settings as Record<string, unknown>),
        log,
        comboName: providerInput,
        comboStrategy: "fallback",
        autoSwitch: false,
      });
    } catch (error) {
      return errorResponse(HTTP_STATUS.BAD_REQUEST, error instanceof Error ? error.message : "Invalid smart routing configuration");
    }
  }

  const combos = await getCombos() as unknown as Parameters<typeof getComboModelsFromData>[1];
  const comboModels: string[] | null = getComboModelsFromData(providerInput, combos);
  if (comboModels) {
    const comboStrategies: Record<string, unknown> = (settings as Record<string, unknown>).comboStrategies as Record<string, unknown> || {};
    const comboStrategy: string = ((comboStrategies[providerInput] as Record<string, unknown> | undefined)?.fallbackStrategy as string) || (settings as Record<string, unknown>).comboStrategy as string || "fallback";
    const comboStickyLimit: number = (settings as Record<string, unknown>).comboStickyRoundRobinLimit as number;
    log.info("SEARCH", `Combo "${providerInput}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b: Record<string, unknown>, m: string) => handleSingleProviderSearch(b, m, request, apiKey, settings as Record<string, unknown>),
      log,
      comboName: providerInput,
      comboStrategy,
      comboStickyLimit
    });
  }

  return handleSingleProviderSearch(body, providerInput, request, apiKey, settings);
}

async function handleSingleProviderSearch(body: Record<string, unknown>, providerInput: string, request: Request, apiKey: string | null, settings: Record<string, unknown>): Promise<Response> {
  const query: string = body.query as string;
  const providerId: string = resolveProviderId(providerInput);
  const resolvedProvider = AI_PROVIDERS[providerId];

  if (!resolvedProvider) {
    log.warn("SEARCH", "Unknown provider", { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown provider: ${providerInput}`);
  }

  const providerConfig = resolvedProvider?.searchConfig as Record<string, unknown> | undefined;
  const supportsSearch: boolean = !!providerConfig || !!(resolvedProvider?.searchViaChat);

  if (!supportsSearch) {
    log.warn("SEARCH", "Provider does not support web search", { provider: providerId });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${providerId} does not support web search`);
  }

  if (providerInput !== providerId) {
    log.info("ROUTING", `${providerInput} → ${providerId}`);
  } else {
    log.info("ROUTING", `Provider: ${providerId}`);
  }

  const coreBody: Record<string, unknown> = {
    query: query.trim(),
    provider: providerId,
    max_results: body.max_results,
    search_type: body.search_type,
    country: body.country,
    language: body.language,
    time_range: body.time_range,
    offset: body.offset,
    domain_filter: body.domain_filter,
    content_options: body.content_options,
    provider_options: body.provider_options
  };

  if (resolvedProvider?.noAuth) {
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider as unknown as Parameters<typeof handleSearchCore>[0]["provider"],
      providerConfig,
      credentials: null as unknown as Record<string, unknown>,
      log: log as unknown as Parameters<typeof handleSearchCore>[0]["log"]
    }) as unknown as Record<string, unknown>;
    if (result.success) return result.response as Response;
    return result.response as Response;
  }

  const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials = await getProviderCredentials(providerId, excludeConnectionIds);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg: string = lastError || credentials.lastError || "Unavailable";
        const status: number = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SEARCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${providerId}] ${errorMsg}`, String(credentials.retryAfter ?? ""), credentials.retryAfterHuman ?? "");
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${providerId}`);
      }
      log.warn("SEARCH", "No more accounts available", { provider: providerId });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);

    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider as unknown as Parameters<typeof handleSearchCore>[0]["provider"],
      providerConfig,
      credentials: refreshedCredentials as unknown as Record<string, unknown>,
      log,
      onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
        await updateProviderCredentials(credentials.connectionId!, {
          accessToken: newCreds.accessToken as string | undefined,
          refreshToken: newCreds.refreshToken as string | undefined,
          providerSpecificData: newCreds.providerSpecificData as Record<string, unknown> | undefined,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId!, credentials);
      }
    } as Parameters<typeof handleSearchCore>[0]) as unknown as Record<string, unknown>;

    if (result.success) return result.response as Response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId!, result.status as number, result.error as string, providerId);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId!);
      lastError = result.error as string;
      lastStatus = result.status as number;
      continue;
    }

    return result.response as Response;
  }
}
