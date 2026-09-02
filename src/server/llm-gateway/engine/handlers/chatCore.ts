import { detectFormat } from "../services/provider";
import { createStreamController } from "../utils/streamHandler";
import { createRequestLogger } from "../utils/requestLogger";
import { HTTP_STATUS, TOKEN_SAVER_HEADER } from "../config/runtimeConfig";
import { handleBypassRequest } from "../utils/bypassHandler";
import { trySynapseIntercept } from "../rtk/synapse";
import { trackPendingRequest, appendRequestLog } from "../host/usage";
import { getExecutor } from "../executors/index";
import { bootstrap } from "@/server/plugin-core/context";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler";
import {
  handleStreamingResponse,
  buildOnStreamComplete,
} from "./chatCore/streamingHandler";
import {
  resolveSessionTag,
  resolveTargetRoute,
  applyProviderThinkingOverride,
  resolveStreamMode,
  prepareTranslatedBody,
  runTokenSavers,
  logRequestSummary,
  applyTtsCleanup,
  logProxyOptions,
  handleExecutionError,
  attemptTokenRefresh,
  handleUpstreamError,
} from "./chatCore/phases";
import type { HandleChatCoreOptions } from "./chatCore/types";

/**
 * Core chat handler - shared between SSE and Worker.
 * Thin orchestrator: each pipeline phase lives in ./chatCore/phases.ts.
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
  onDisconnect,
  clientRawRequest,
  connectionId,
  userAgent,
  apiKey,
  ccFilterNaming,
  rtkEnabled,
  headroomEnabled,
  headroomUrl,
  headroomCompressUserMessages,
  cavemanEnabled,
  cavemanLevel,
  ponytailEnabled,
  ponytailLevel,
  synapseEnabled,
  synapseLevel,
  pxpipeEnabled,
  pxpipeMinChars,
  pxpipeTimeoutMs,
  pxpipeTransform,
  onPxpipeEvent,
  sourceFormatOverride,
  providerThinking,
}: HandleChatCoreOptions) {
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();
  const reqTag = resolveSessionTag({
    log,
    clientRawRequest,
    body,
    connectionId,
    provider,
  });

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(
    body,
    model,
    userAgent,
    ccFilterNaming as boolean | undefined,
  );
  if (bypassResponse) return bypassResponse;

  const { alias, targetFormat, stripList, upstreamModel } = resolveTargetRoute({
    provider,
    sourceFormat,
    model,
    credentials,
  });

  body = applyProviderThinkingOverride(body, providerThinking);

  const {
    stream,
    clientRequestedStreaming,
    providerRequiresStreaming,
    detectedTool,
  } = resolveStreamMode({
    body,
    sourceFormat,
    provider,
    alias,
    model,
    clientRawRequest,
  });

  const reqLogger = await createRequestLogger(
    sourceFormat,
    targetFormat,
    model,
  );
  if (clientRawRequest)
    reqLogger.logClientRawRequest(
      clientRawRequest.endpoint as string,
      clientRawRequest.body,
      clientRawRequest.headers,
    );
  reqLogger.logRawRequest(body);
  log?.debug?.(
    "FORMAT",
    `${sourceFormat} → ${targetFormat} | stream=${stream}`,
  );

  const prepared = await prepareTranslatedBody({
    body,
    sourceFormat,
    targetFormat,
    upstreamModel,
    stripList,
    credentials,
    provider,
    model,
    stream,
    connectionId,
    clientTool: detectedTool,
    clientRawRequest,
    reqLogger,
    log,
  });
  if ("error" in prepared) return prepared.error;
  const {
    passthrough,
    clientTool,
    translatedBody,
    toolNameMap,
    customToolNames,
  } = prepared;

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  logRequestSummary({
    log,
    reqTag,
    clientRawRequest,
    body,
    translatedBody,
    passthrough,
    sourceFormat,
    targetFormat,
    provider,
    model,
    stream,
    credentials,
  });

  applyTtsCleanup({ alias, model, translatedBody });

  // Per-request opt-out: client can bypass all token savers via header
  const tokenSaverEnabled =
    (clientRawRequest?.headers as Record<string, string> | undefined)?.[
      TOKEN_SAVER_HEADER
    ]?.toLowerCase() !== "off";

  // Synapse: deterministic zero-cost replies for trivial pt-BR patterns.
  // Short-circuits the provider call entirely — only fires on tools-free chat.
  const synapseResponse = trySynapseIntercept({
    body,
    sourceFormat,
    stream,
    model,
    provider,
    enabled: tokenSaverEnabled && (synapseEnabled ?? false),
    level: synapseLevel,
    log,
    reqTag,
  });
  if (synapseResponse) return synapseResponse;

  const saverResult = await runTokenSavers({
    translatedBody,
    finalFormat,
    upstreamModel,
    tokenSaverEnabled,
    rtkEnabled,
    headroomEnabled,
    headroomUrl,
    headroomCompressUserMessages,
    cavemanEnabled,
    cavemanLevel,
    ponytailEnabled,
    ponytailLevel,
    pxpipeEnabled,
    pxpipeMinChars,
    pxpipeTimeoutMs,
    pxpipeTransform,
    onPxpipeEvent,
    provider,
    model,
    reqTag,
    log,
    finalizeClaudeCache: passthrough && clientTool === "claude",
  });
  const { translatedBody: finalTranslatedBody, pxpipeSummary } = saverResult;

  // Plugin-provided executors (such as OpenCode) are registered during the
  // runtime bootstrap. Ensure it has completed before resolving the executor,
  // otherwise a first chat request can fall back to DefaultExecutor.
  await bootstrap();
  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog().catch(() => {});

  const msgCount =
    (finalTranslatedBody.messages as unknown[])?.length ||
    (finalTranslatedBody.input as unknown[])?.length ||
    (finalTranslatedBody.contents as unknown[])?.length ||
    ((finalTranslatedBody.request as Record<string, unknown>)?.contents &&
      (
        (finalTranslatedBody.request as Record<string, unknown>)
          .contents as unknown[]
      )?.length) ||
    0;
  log?.debug?.(
    "REQUEST",
    `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`,
  );

  const streamController = createStreamController({
    onDisconnect: (reason: string) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log,
    provider,
    model,
    reqTag,
  } as unknown as Parameters<typeof createStreamController>[0]);

  const proxyOptions = {
    connectionProxyEnabled:
      credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl:
      credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy:
      credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };
  logProxyOptions({ proxyOptions, credentials, provider, model, log });

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  // Most executors return their registry format. Cursor AgentService is an
  // exception: it is decoded by the executor into OpenAI-compatible output.
  let providerResponseFormat = targetFormat;
  try {
    const result = await executor.execute({
      model,
      body: finalTranslatedBody,
      stream,
      credentials,
      signal: streamController.signal,
      log,
      proxyOptions,
    });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    providerResponseFormat = result.responseFormat || targetFormat;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error: unknown) {
    return handleExecutionError({
      error,
      provider,
      model,
      connectionId,
      requestStartTime,
      body,
      stream,
      translatedBody: finalTranslatedBody,
      pxpipeSummary,
      reqTag,
      log,
      streamController,
    });
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (
    !executor.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const refreshed = await attemptTokenRefresh({
      executor,
      providerResponse,
      providerUrl,
      providerResponseFormat,
      credentials,
      onCredentialsRefreshed,
      executeParams: {
        model,
        body: finalTranslatedBody,
        stream,
        signal: streamController.signal,
        log,
        proxyOptions,
      },
      provider,
      model,
      reqTag,
      log,
    });
    providerResponse = refreshed.providerResponse;
    providerUrl = refreshed.providerUrl;
    providerResponseFormat = refreshed.providerResponseFormat;
  }

  // Provider returned error
  if (!providerResponse.ok) {
    return handleUpstreamError({
      providerResponse,
      providerUrl,
      executor,
      provider,
      model,
      connectionId,
      requestStartTime,
      body,
      stream,
      translatedBody: finalTranslatedBody,
      finalBody,
      pxpipeSummary,
      reqTag,
      log,
      reqLogger: reqLogger as unknown as Parameters<
        typeof handleUpstreamError
      >[0]["reqLogger"],
    });
  }

  const sharedCtx = {
    provider,
    model,
    body,
    stream,
    translatedBody: finalTranslatedBody,
    finalBody,
    requestStartTime,
    connectionId,
    apiKey,
    clientRawRequest,
    onRequestSuccess,
    pxpipe: pxpipeSummary,
    reqTag,
    log,
  };
  const appendLog = (_extra: Record<string, unknown>) =>
    appendRequestLog().catch(() => {});
  const trackDone = () =>
    trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      targetFormat: providerResponseFormat,
      customToolNames: customToolNames as unknown as Set<string> | undefined,
      trackDone,
      appendLog,
    });
    if (result) {
      streamController.handleComplete();
      return result;
    }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      targetFormat: providerResponseFormat,
      reqLogger: reqLogger as unknown as Parameters<
        typeof handleNonStreamingResponse
      >[0]["reqLogger"],
      toolNameMap: toolNameMap as unknown as Record<string, string> | undefined,
      customToolNames: customToolNames as unknown as Set<string> | undefined,
      trackDone,
      appendLog,
    });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
    ...sharedCtx,
  });
  return handleStreamingResponse({
    ...sharedCtx,
    providerResponse,
    sourceFormat,
    targetFormat: providerResponseFormat,
    userAgent,
    reqLogger: reqLogger as unknown as Parameters<
      typeof handleStreamingResponse
    >[0]["reqLogger"],
    toolNameMap: toolNameMap as unknown as Record<string, string> | undefined,
    customToolNames: customToolNames as unknown as Set<string> | undefined,
    streamController,
    onStreamComplete,
    streamDetailId,
  });
}
