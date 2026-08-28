import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth";
import { getSettings, getCombos } from "@/lib/localDb";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import { handleFetchCore } from "@/lib/open-sse/handlers/fetch/index";
import { errorResponse, unavailableResponse } from "@/lib/open-sse/utils/error";
import { HTTP_STATUS } from "@/lib/open-sse/config/runtimeConfig";
import * as log from "../utils/logger";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh";
import { handleComboChat, getComboModelsFromData } from "@/lib/open-sse/services/combo";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard";
import { attachRoutingDecision } from "@/lib/open-sse/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/lib/open-sse/services/smart-routing/router";
import { classifySmartRouting } from "../services/smartRoutingClassifier";

/**
 * Handle web fetch (URL extraction) request for the SSE/Next.js server.
 */
export async function handleFetch(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    log.warn("FETCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const reqUrl: URL = new URL(request.url);
  const providerInput: string = (body.provider || body.model) as string;
  const targetUrl: string = body.url as string;
  const format: string = body.format as string;
  const maxCharacters: number = body.max_characters as number;

  log.request("POST", `${reqUrl.pathname} | ${providerInput}`);

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
    log.warn("FETCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }

  if (!targetUrl || typeof targetUrl !== "string") {
    log.warn("FETCH", "Missing url");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: url");
  }

  try {
    new URL(targetUrl);
  } catch {
    log.warn("FETCH", "Invalid URL", { url: targetUrl });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid URL format");
  }

  try {
    assertPublicUrl(targetUrl);
  } catch (err: unknown) {
    log.warn("FETCH", "Blocked URL", { url: targetUrl });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, (err instanceof Error ? err.message : String(err)));
  }

  const smartCombo = await getSmartCombo(providerInput);
  if (smartCombo) {
    try {
      const routing = await resolveSmartRouting({
        combo: smartCombo,
        body,
        headers: request.headers,
        endpointNeed: "web_fetch",
        sessionKey: deriveRoutingSessionKey(request.headers, body),
        classifyWithModel: (model, prompt, timeoutMs) => classifySmartRouting(model, prompt, timeoutMs, request, apiKey),
      });
      const providers = [...new Set(routing.models.map((candidate) => candidate.split("/", 1)[0]).filter(Boolean))];
      if (providers.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No compatible web fetch provider is active");
      attachRoutingDecision(body, routing.meta);
      log.info("ROUTING", `Smart combo "${providerInput}" → web_fetch/${routing.meta.tier} → ${providers[0]}`);
      return handleComboChat({
        body,
        models: providers,
        handleSingleModel: (b: Record<string, unknown>, provider: string) => handleSingleProviderFetch(b, provider, request, apiKey, settings as Record<string, unknown>),
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
    log.info("FETCH", `Combo "${providerInput}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b: Record<string, unknown>, m: string) => handleSingleProviderFetch(b, m, request, apiKey, settings as Record<string, unknown>),
      log,
      comboName: providerInput,
      comboStrategy,
      comboStickyLimit
    });
  }

  return handleSingleProviderFetch(body, providerInput, request, apiKey, settings);
}

async function handleSingleProviderFetch(body: Record<string, unknown>, providerInput: string, request: Request, apiKey: string | null, settings: Record<string, unknown>): Promise<Response> {
  const targetUrl: string = body.url as string;
  const format: string = body.format as string;
  const maxCharacters: number = body.max_characters as number;
  const providerId: string = resolveProviderId(providerInput);
  const resolvedProvider = AI_PROVIDERS[providerId];

  if (!resolvedProvider) {
    log.warn("FETCH", "Unknown provider", { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown provider: ${providerInput}`);
  }

  const providerConfig = resolvedProvider?.fetchConfig as Record<string, unknown> | undefined;
  if (!providerConfig) {
    log.warn("FETCH", "Provider does not support web fetch", { provider: providerId });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${providerId} does not support web fetch`);
  }

  if (providerInput !== providerId) {
    log.info("ROUTING", `${providerInput} → ${providerId}`);
  } else {
    log.info("ROUTING", `Provider: ${providerId}`);
  }

  const fetchProviderId = typeof resolvedProvider.id === "string" ? resolvedProvider.id : providerId;

  if (resolvedProvider.noAuth) {
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleFetchCore({
      url: targetUrl,
      format,
      maxCharacters,
      provider: resolvedProvider!.id as string,
      providerConfig,
      credentials: undefined,
      log: log as unknown as Parameters<typeof handleFetchCore>[0]["log"]
    }) as unknown as Record<string, unknown>;
    if (result.success) {
      return new Response(JSON.stringify(result.data), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    return errorResponse((result.status as number) || HTTP_STATUS.BAD_GATEWAY, (result.error as string) || "Fetch failed");
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
        log.warn("FETCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${providerId}] ${errorMsg}`, String(credentials.retryAfter ?? ""), credentials.retryAfterHuman ?? "");
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${providerId}`);
      }
      log.warn("FETCH", "No more accounts available", { provider: providerId });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);

    const result = await handleFetchCore({
      url: targetUrl,
      format,
      maxCharacters,
      provider: fetchProviderId,
      providerConfig,
      credentials: refreshedCredentials as unknown as Record<string, unknown>,
      log: log as unknown as (...args: unknown[]) => void,
      onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
        await updateProviderCredentials(credentials.connectionId!, {
          accessToken: newCreds.accessToken as string | undefined,
          refreshToken: newCreds.refreshToken as string | undefined,
          providerSpecificData: newCreds.providerSpecificData as Record<string, unknown> | undefined,
          testStatus: "active"
        });
      }
    } as unknown as Parameters<typeof handleFetchCore>[0]) as unknown as Record<string, unknown>;

    if (result.success) {
      await clearAccountError(credentials.connectionId!, credentials);
      return new Response(JSON.stringify(result.data), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId!, result.status as number, result.error as string, providerId);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId!);
      lastError = result.error as string;
      lastStatus = result.status as number;
      continue;
    }

    return errorResponse((result.status as number) || HTTP_STATUS.BAD_GATEWAY, (result.error as string) || "Fetch failed");
  }
}
