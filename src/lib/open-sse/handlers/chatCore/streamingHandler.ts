import { FORMATS } from "../../translator/formats";
import { needsTranslation } from "../../translator/index";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream";
import { pipeWithDisconnect } from "../../utils/streamHandler";
import { PROVIDERS } from "../../config/providers";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail";
import { saveRequestDetail } from "@/lib/usageDb";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants";
import type { StreamingHandlerContext, OnStreamCompleteContext } from "./types";

// Local types
interface JsonObject { [key: string]: unknown }

// Codex returns Responses API SSE → which client format to translate INTO, by request sourceFormat.
const CODEX_SOURCE_TO_TARGET: Record<string, string> = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey }: {
  provider: string;
  sourceFormat: string;
  targetFormat: string;
  userAgent?: string;
  reqLogger: Record<string, unknown>;
  toolNameMap?: Record<string, string>;
  customToolNames?: Set<string>;
  model: string;
  connectionId: string;
  body: Record<string, unknown>;
  onStreamComplete: (contentObj: Record<string, unknown>, usage: Record<string, unknown> | null, ttftAt: number | null) => void;
  apiKey?: string;
}) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  const isResponsesProvider = (PROVIDERS[provider] as Record<string, unknown>)?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider as unknown as null, reqLogger as unknown as null, toolNameMap as unknown as null, model as unknown as null, connectionId as unknown as null, body as unknown as null, onStreamComplete as unknown as null, apiKey as unknown as null, customToolNames as unknown as null);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider as unknown as null, reqLogger as unknown as null, toolNameMap as unknown as null, model as unknown as null, connectionId as unknown as null, body as unknown as null, onStreamComplete as unknown as null, apiKey as unknown as null, customToolNames as unknown as null);
  }

  return createPassthroughStreamWithLogger(provider as unknown as null, reqLogger as unknown as null, model as unknown as null, connectionId as unknown as null, body as unknown as null, onStreamComplete as unknown as null, apiKey as unknown as null);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, pxpipe, reqTag, log }: StreamingHandlerContext) {
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch((err: unknown) => {
        console.error("[ChatCore] onRequestSuccess failed:", (err as Error)?.message || err);
      });
  }

  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    const status = providerResponse.status || 502;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger: reqLogger as unknown as Record<string, unknown>, toolNameMap: toolNameMap as Record<string, string> | undefined, customToolNames: customToolNames as Set<string> | undefined, model, connectionId, body, onStreamComplete, apiKey });

  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = ((PROVIDERS[provider] as Record<string, unknown>)?.stallTimeoutMs as number) || STREAM_STALL_TIMEOUT_MS;
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController as unknown as Parameters<typeof pipeWithDisconnect>[2], onAbortTerminal as unknown as Parameters<typeof pipeWithDisconnect>[3], stallTimeoutMs);

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch((err: unknown) => {
    console.error("[RequestDetail] Failed to save streaming request:", (err as Error).message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe, reqTag, log }: OnStreamCompleteContext) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj: Record<string, unknown>, usage: Record<string, unknown> | null, ttftAt: number | null) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      pxpipe,
      status: "success"
    }, { id: streamDetailId })).catch((err: unknown) => {
      console.error("[RequestDetail] Failed to update streaming content:", (err as Error).message);
    });

    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));
  };

  return { onStreamComplete, streamDetailId };
}
