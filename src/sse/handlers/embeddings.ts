import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model";
import { handleEmbeddingsCore } from "@/lib/open-sse/handlers/embeddingsCore";
import { errorResponse, unavailableResponse } from "@/lib/open-sse/utils/error";
import { HTTP_STATUS } from "@/lib/open-sse/config/runtimeConfig";
import * as log from "../utils/logger";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh";
import { saveRequestUsage } from "@/lib/usageDb";
import { handleComboChat } from "@/lib/open-sse/services/combo";
import { attachRoutingDecision } from "@/lib/open-sse/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/lib/open-sse/services/smart-routing/router";
import { classifySmartRouting } from "../services/smartRoutingClassifier";

interface EmbeddingUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

type EmbeddingsCoreResult =
  | { success: true; usage: unknown; response: Response }
  | { success: false; status: number; error: string; resetsAtMs?: number; response: Response };

function exactEmbeddingUsage(raw: unknown): EmbeddingUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as Record<string, unknown>).estimated === true) return null;
  const r = raw as Record<string, unknown>;
  const promptTokens: number = (r.prompt_tokens ?? r.input_tokens) as number;
  const completionTokens: number = ((r.completion_tokens ?? r.output_tokens ?? 0)) as number;
  const totalTokens: number = r.total_tokens as number;
  if (!Number.isSafeInteger(promptTokens) || promptTokens <= 0 || completionTokens !== 0 || totalTokens !== promptTokens) return null;
  return { prompt_tokens: promptTokens, completion_tokens: 0, total_tokens: totalTokens };
}

/**
 * Handle embeddings request for the SSE/Next.js server.
 */
export async function handleEmbeddings(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsedBody: unknown = await request.json();
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      throw new Error("Expected a JSON object");
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    log.warn("EMBEDDINGS", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url: URL = new URL(request.url);
  const modelStr: string | undefined = typeof body.model === "string" ? body.model : undefined;

  log.request("POST", `${url.pathname} | ${modelStr}`);

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

  if (!modelStr) {
    log.warn("EMBEDDINGS", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  if (!body.input) {
    log.warn("EMBEDDINGS", "Missing input");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  const smartCombo = await getSmartCombo(modelStr);
  if (smartCombo) {
    try {
      const routing = await resolveSmartRouting({
        combo: smartCombo,
        body,
        headers: request.headers,
        endpointNeed: "embeddings",
        sessionKey: deriveRoutingSessionKey(request.headers, body),
        classifyWithModel: (model, prompt, timeoutMs) => classifySmartRouting(model, prompt, timeoutMs, request, apiKey),
      });
      if (routing.models.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No compatible embedding model is active");
      attachRoutingDecision(body, routing.meta);
      log.info("ROUTING", `Smart combo "${modelStr}" → embeddings/${routing.meta.tier} → ${routing.models[0]}`);
      return handleComboChat({
        body,
        models: routing.models,
        handleSingleModel: (nextBody: Record<string, unknown>, model: string) => handleEmbeddings(new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify({ ...nextBody, model }),
          signal: request.signal,
        })),
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
  if (!modelInfo.provider) {
    log.warn("EMBEDDINGS", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const excludeConnectionIds: Set<string> = new Set();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg: string = lastError || credentials.lastError || "Unavailable";
        const status: number = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("EMBEDDINGS", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, String(credentials.retryAfter ?? ""), credentials.retryAfterHuman ?? "");
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("EMBEDDINGS", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const connectionId = credentials.connectionId;
    if (!connectionId) {
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Selected provider account has no connection ID");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const result = await handleEmbeddingsCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials as unknown as Record<string, unknown>,
      log: log as unknown as Parameters<typeof handleEmbeddingsCore>[0]["log"],
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
    }) as unknown as EmbeddingsCoreResult;

    if (result.success) {
      const usage: EmbeddingUsage | null = exactEmbeddingUsage(result.usage);
      if (usage) {
        saveRequestUsage({
          provider,
          model,
          connectionId,
          apiKey: apiKey ?? undefined,
          endpoint: url.pathname,
          tokens: usage as unknown as Record<string, unknown>,
          status: "success",
        }).catch(() => {});
      }
      return result.response as Response;
    }

    const { shouldFallback } = await markAccountUnavailable(connectionId, result.status, result.error, provider, model);

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response as Response;
  }
}
