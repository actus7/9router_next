import { requireGatewayApiKey } from "./gatewayApiKey";
import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
} from "../auth/accountSelection";
import { getModelInfo, assertModelEnabled } from "./modelResolution";
import { handleEmbeddingsCore } from "@/server/llm-gateway/engine/handlers/embeddingsCore";
import { errorResponse, unavailableResponse } from "@/server/llm-gateway/engine/utils/error";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import { resolveAccountExhaustion } from "@/server/llm-gateway/engine/services/accountFallback";
import * as log from "../utils/logger";
import { updateProviderCredentials, checkAndRefreshToken } from "../auth/tokenRefresh";
import { saveRequestDetail, saveRequestUsage } from "@/lib/usageDb";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { attachRoutingDecision } from "@/server/llm-gateway/engine/services/smart-routing/context";
import { deriveRoutingSessionKey, getSmartCombo, resolveSmartRouting } from "@/server/llm-gateway/engine/services/smart-routing/router";
import { classifySmartRouting } from "./smartRoutingClassifier";

interface EmbeddingUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

type EmbeddingsCoreResult =
  | { success: true; usage: unknown; response: Response }
  | { success: false; status: number; error: string; resetsAtMs?: number; response: Response };

/**
 * Normalize an embedding provider's usage report.
 *
 * `estimated` marks a count the provider did not actually give us. It used to
 * be a reason to record nothing at all, which meant a provider without exact
 * accounting produced a silent zero — the request happened, the tokens were
 * spent, and the ledger said nothing. A flagged approximation is strictly
 * better than a confident zero: the zero is not conservative, it is wrong in a
 * direction the operator cannot see.
 */
function normalizeEmbeddingUsage(
  raw: unknown,
): (EmbeddingUsage & { estimated?: true }) | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const estimated: boolean = r.estimated === true;

  const promptTokens: number = (r.prompt_tokens ?? r.input_tokens) as number;
  const completionTokens: number = ((r.completion_tokens ?? r.output_tokens ?? 0)) as number;
  const totalTokens: number = r.total_tokens as number;

  if (!Number.isSafeInteger(promptTokens) || promptTokens <= 0) return null;
  if (completionTokens !== 0) return null;

  // An exact report has to be internally consistent; an estimate is allowed to
  // omit or disagree on the total, which is then derived.
  if (!estimated && totalTokens !== promptTokens) return null;

  const usage: EmbeddingUsage & { estimated?: true } = {
    prompt_tokens: promptTokens,
    completion_tokens: 0,
    total_tokens: Number.isSafeInteger(totalTokens) ? totalTokens : promptTokens,
  };
  if (estimated) usage.estimated = true;
  return usage;
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

  const authError = await requireGatewayApiKey(apiKey);
  if (authError) return authError;

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

  const disabledResponse = await assertModelEnabled(provider, model);
  if (disabledResponse) return disabledResponse;

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
      // One owner for the three outcomes, shared with the chat path — this is
      // where the 404-vs-400 drift lived.
      const exhaustion = resolveAccountExhaustion(
        provider, model, credentials, excludeConnectionIds.size, lastError, lastStatus,
      );
      if (exhaustion.kind === "rate-limited") {
        log.warn("EMBEDDINGS", `${exhaustion.message} (${exhaustion.retryAfterHuman})`);
        return unavailableResponse(exhaustion.status, exhaustion.message, exhaustion.retryAfter, exhaustion.retryAfterHuman);
      }
      log.warn(exhaustion.kind === "no-accounts" ? "AUTH" : "EMBEDDINGS", exhaustion.message, { provider });
      return errorResponse(exhaustion.status, exhaustion.message);
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
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(connectionId, credentials, model);
      }
    }) as unknown as EmbeddingsCoreResult;

    if (result.success) {
      const usage = normalizeEmbeddingUsage(result.usage);
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
      // Embeddings never wrote a request detail, so an embedding showed up in
      // the Usage totals but never in the request-detail drill-down — anyone
      // debugging one concluded the call had not happened. Best-effort like
      // every other caller: a failed detail write must not fail the request.
      saveRequestDetail({
        provider,
        model,
        connectionId,
        timestamp: new Date().toISOString(),
        status: "success",
        latency: { ttft: 0, total: 0 },
        tokens: (usage ?? {}) as unknown as Record<string, unknown>,
        request: { endpoint: url.pathname, body },
        response: {},
      });
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
