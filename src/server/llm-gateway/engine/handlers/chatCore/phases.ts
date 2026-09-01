/**
 * Phase helpers extracted from chatCore.ts — one function per pipeline phase.
 * All logic is moved verbatim from the original orchestrator; behavior is identical.
 * Phases: session tag → route → thinking override → stream mode → body preparation
 * → token savers → proxy logging → execution error → token refresh → upstream error.
 */

import { getTargetFormat, resolveTransport } from "../../services/provider";
import { translateRequest } from "../../translator/index";
import { applyThinking, extractThinking, stripThinkingSuffix } from "../../translator/concerns/thinkingUnified";
import { FORMATS } from "../../translator/formats";
import { normalizeClaudePassthrough, anchorClaudeCache } from "../../translator/formats/claude";
import { createErrorResult } from "../../utils/error";
import { HTTP_STATUS } from "../../config/runtimeConfig";
import { trackPendingRequest } from "../../host/usage";
import { supportsGrokCliReasoningEffort } from "../../config/grokCli";
import { detectClientTool, isNativePassthrough } from "../../utils/clientDetector";
import { dedupeTools } from "../../utils/toolDeduper";
import { injectCaveman } from "../../rtk/caveman";
import { injectPonytail } from "../../rtk/ponytail";
import { compressMessages, formatRtkLog } from "../../rtk/index";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../../rtk/headroom";
import { compressWithPxpipe } from "../../rtk/pxpipe";
import { getCapabilitiesForModel } from "../../providers/capabilities";
import { stripUnsupportedModalities } from "../../translator/concerns/modality";
import { prefetchRemoteImages } from "../../translator/concerns/prefetch";
import { resolveSessionId } from "../../utils/sessionManager";
import { getModelTargetFormat, getModelSupportedFormats, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../../config/providerModels";
import { PROVIDERS } from "../../config/providers";
import type { ChatCredentials, ChatLogger, ClientRawRequest, HeadroomDiagnostics, PxpipeSummary, ProviderThinkingConfig } from "./types";

// ---------------------------------------------------------------------------
// Session tag
// ---------------------------------------------------------------------------

export function resolveSessionTag(params: {
  log?: ChatLogger;
  clientRawRequest?: ClientRawRequest;
  body: Record<string, unknown>;
  connectionId: string;
  provider: string;
}): string {
  // Stable per-session color so all lines of one CLI conversation share a tag
  const sessionSeed = (() => {
    try {
      return resolveSessionId({ headers: params.clientRawRequest?.headers, body: params.body, connectionId: params.connectionId, scope: params.provider });
    } catch {
      return params.connectionId || "";
    }
  })();
  return params.log?.tagForSession ? params.log.tagForSession(sessionSeed) : (params.log?.nextTag ? params.log.nextTag() : "");
}

// ---------------------------------------------------------------------------
// Route resolution (alias / transport / target format / strip list)
// ---------------------------------------------------------------------------

export function resolveTargetRoute(params: {
  provider: string;
  sourceFormat: string;
  model: string;
  credentials: ChatCredentials;
}): { alias: string; targetFormat: string; stripList: unknown; upstreamModel: string } {
  const { provider, sourceFormat, model, credentials } = params;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation.
  // Per-model guard: only use the transport when the model declares support for that
  // sourceFormat — opencode-go models differ in endpoint support (kimi/glm only do
  // /chat/completions), so without this guard a claude-format request would wrongly
  // route kimi to /messages.
  const modelSupportedFormats = getModelSupportedFormats(alias, model);
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  // Per-model guard: when a model declares supportedFormats, only use the
  // sourceFormat-matched transport if that format is declared (opencode-go models
  // differ — kimi/glm only do /chat/completions). Undeclared models keep the
  // upstream default (use the transport), preserving behavior for glm/deepseek/...
  const useTransport = (!modelSupportedFormats || (modelSupportedFormats as string[]).includes(sourceFormat)) ? runtimeTransport : null;
  const targetFormat = modelTargetFormat || useTransport?.format || getTargetFormat(provider, credentials as Record<string, unknown>);
  if (useTransport && credentials) credentials.runtimeTransport = useTransport;
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);
  return { alias, targetFormat, stripList, upstreamModel };
}

// ---------------------------------------------------------------------------
// Provider-level thinking override
// ---------------------------------------------------------------------------

export function applyProviderThinkingOverride(
  body: Record<string, unknown>,
  providerThinking?: ProviderThinkingConfig,
): Record<string, unknown> {
  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.error("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }
  return body;
}

// ---------------------------------------------------------------------------
// Streaming mode resolution
// ---------------------------------------------------------------------------

export function resolveStreamMode(params: {
  body: Record<string, unknown>;
  sourceFormat: string;
  provider: string;
  alias: string;
  model: string;
  clientRawRequest?: ClientRawRequest;
}): { stream: boolean; clientRequestedStreaming: boolean; providerRequiresStreaming: boolean; detectedTool: string | null } {
  const { body, sourceFormat, provider, alias, model, clientRawRequest } = params;

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = (PROVIDERS as Record<string, Record<string, unknown>>)[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  return { stream, clientRequestedStreaming, providerRequiresStreaming, detectedTool };
}

// ---------------------------------------------------------------------------
// Translated body preparation (passthrough vs translate)
// ---------------------------------------------------------------------------

/**
 * Remove translator-internal continuity fields from the outbound upstream
 * body. The Responses→Chat request translator stashes reasoning
 * `encrypted_content` on assistant messages so a later openai→responses
 * round-trip can restore the store=false continuity blob; that stash must
 * never reach an upstream provider. Chat-native proxies reject the unknown
 * assistant-message field and answer every turn with a literal "400" body
 * (observed with multi-turn Codex sessions via OpenAI-compatible nodes).
 */
function stripContinuityFields(body: Record<string, unknown>): Record<string, unknown> {
  if (!body || !Array.isArray(body.messages)) return body;
  for (const msg of body.messages) {
    if (msg && typeof msg === "object") {
      delete msg.encrypted_content;
      delete msg.reasoning_encrypted_content;
    }
  }
  return body;
}

export type PreparedBody =
  | { error: ReturnType<typeof createErrorResult>; passthrough: false }
  | { passthrough: boolean; clientTool: string | null; translatedBody: Record<string, unknown>; toolNameMap: unknown; customToolNames: unknown };

export async function prepareTranslatedBody(params: {
  body: Record<string, unknown>;
  sourceFormat: string;
  targetFormat: string;
  upstreamModel: string;
  stripList: unknown;
  credentials: ChatCredentials;
  provider: string;
  model: string;
  stream: boolean;
  connectionId: string;
  clientTool: string | null;
  clientRawRequest?: ClientRawRequest;
  reqLogger: unknown;
  log?: ChatLogger;
}): Promise<PreparedBody> {
  const { body, sourceFormat, targetFormat, upstreamModel, stripList, credentials, provider, model, stream, connectionId, clientTool, clientRawRequest, reqLogger, log } = params;

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip unsupported media + prefetch remote images — translation only
  // (original ordering: rawHeaders → modality normalization → translate/passthrough)
  if (!passthrough) {
    await normalizeModalities({ body, sourceFormat, targetFormat, provider, model, passthrough, log });
  }

  let translatedBody: Record<string, unknown>;
  let toolNameMap: unknown;
  let customToolNames: unknown;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: stripThinkingSuffix(upstreamModel) };
    if (provider === "codex") {
      const suffixThinking: Record<string, unknown> = {};
      applyThinking(sourceFormat, upstreamModel, suffixThinking, provider as unknown as null);
      if (suffixThinking.reasoning_effort) {
        const reasoning = (translatedBody as Record<string, unknown>).reasoning;
        (translatedBody as Record<string, unknown>).reasoning = {
          ...(reasoning && typeof reasoning === "object" && !Array.isArray(reasoning) ? reasoning : {}),
          effort: suffixThinking.reasoning_effort,
        };
        delete (translatedBody as Record<string, unknown>).reasoning_effort;
      }
    }
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model as string | undefined);
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, upstreamModel, body, stream, credentials, provider, reqLogger as Parameters<typeof translateRequest>[7], stripList as string[], connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(params.model, provider, connectionId, false, true);
      return { error: createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`, undefined), passthrough: false };
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    customToolNames = translatedBody._customToolNames;
    delete translatedBody._customToolNames;
    translatedBody.model = stripThinkingSuffix(upstreamModel);
    stripContinuityFields(translatedBody);
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  return { passthrough, clientTool, translatedBody, toolNameMap, customToolNames };
}

// ---------------------------------------------------------------------------
// Modality normalization (strip unsupported media + prefetch remote images)
// ---------------------------------------------------------------------------

export async function normalizeModalities(params: {
  body: Record<string, unknown>;
  sourceFormat: string;
  targetFormat: string;
  provider: string;
  model: string;
  passthrough: boolean;
  log?: ChatLogger;
}): Promise<void> {
  const { body, sourceFormat, targetFormat, provider, model, passthrough, log } = params;
  if (passthrough) return;
  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  const caps = getCapabilitiesForModel(provider, model);
  if (stripUnsupportedModalities(body, sourceFormat, caps)) {
    log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
  }
  // Convert remote image URLs to base64 for targets that can't fetch URLs.
  try {
    const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: undefined });
    if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
  } catch (e: unknown) { log?.warn?.("MODALITY", `image prefetch failed: ${(e as Error).message}`); }
}

// ---------------------------------------------------------------------------
// Token savers (RTK / Headroom / Caveman / Ponytail / PXPIPE)
// ---------------------------------------------------------------------------

export async function runTokenSavers(params: {
  translatedBody: Record<string, unknown>;
  finalFormat: string;
  upstreamModel: string;
  tokenSaverEnabled: boolean;
  rtkEnabled?: boolean;
  headroomEnabled?: boolean;
  headroomUrl?: string;
  headroomCompressUserMessages?: boolean;
  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  ponytailEnabled?: boolean;
  ponytailLevel?: string;
  pxpipeEnabled?: boolean;
  pxpipeMinChars?: number;
  pxpipeTimeoutMs?: number;
  pxpipeTransform?: unknown;
  onPxpipeEvent?: (event: Record<string, unknown>) => void;
  provider: string;
  model: string;
  reqTag: string;
  log?: ChatLogger;
  finalizeClaudeCache?: boolean;
}): Promise<{ translatedBody: Record<string, unknown>; pxpipeSummary: PxpipeSummary | null }> {
  const { translatedBody, finalFormat, upstreamModel, tokenSaverEnabled, rtkEnabled, headroomEnabled, headroomUrl, headroomCompressUserMessages, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, pxpipeEnabled, pxpipeMinChars, pxpipeTimeoutMs, pxpipeTransform, onPxpipeEvent, provider, model, reqTag, log } = params;
  let body = translatedBody;

  // RTK: compress tool_result content
  const rtkStats = compressMessages(body, tokenSaverEnabled && (rtkEnabled ?? false));
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics: HeadroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(body, { enabled: tokenSaverEnabled && headroomEnabled, url: headroomUrl, model: upstreamModel, format: finalFormat, compressUserMessages: headroomCompressUserMessages, diagnostics: headroomDiagnostics } as unknown as Parameters<typeof compressWithHeadroom>[1]);
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics as unknown as Parameters<typeof formatHeadroomSizeLog>[0]);
  if (headroomLine) {
    log?.info?.("HEADROOM", `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`);
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics as unknown as Parameters<typeof isHeadroomPhantomSavings>[1])) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${formatHeadroomSizeLog(headroomDiagnostics as unknown as Parameters<typeof formatHeadroomSizeLog>[0])}`);
    }
  } else if (tokenSaverEnabled && headroomEnabled) log?.warn?.("HEADROOM", `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`);

  // Token-saver flags accumulator for the single "⚙" log line below.
  const xf = [];

  // Caveman: inject terse-style system prompt
  if (tokenSaverEnabled && cavemanEnabled && cavemanLevel) {
    injectCaveman(body, finalFormat, cavemanLevel);
    xf.push(`CAVEMAN:${cavemanLevel}`);
  }

  // Ponytail: inject lazy-senior-dev system prompt
  if (tokenSaverEnabled && ponytailEnabled && ponytailLevel) {
    injectPonytail(body, finalFormat, ponytailLevel);
    xf.push(`PONYTAIL:${ponytailLevel}`);
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary = null;
  if (pxpipeEnabled) {
    const pxpipeResult = await compressWithPxpipe(body, {
      enabled: true, format: finalFormat, model: upstreamModel,
      minChars: pxpipeMinChars, timeoutMs: pxpipeTimeoutMs, transform: pxpipeTransform as ((opts: unknown) => Promise<unknown>) | undefined,
    });
    pxpipeSummary = pxpipeResult.summary;
    if (pxpipeResult.body) body = pxpipeResult.body;
    if (pxpipeSummary?.applied) xf.push(`PXPIPE:${(pxpipeSummary as PxpipeSummary).imageCount ?? 0}img`);
    try { onPxpipeEvent?.({ provider, model, ...pxpipeSummary }); } catch { /* stats must not break requests */ }
  }

  if (xf.length && log?.line) log.line(reqTag, "⚙", xf.join(" · "));

  // Pin cache breakpoints to the final body — every saver above can reshape
  // system/tools/messages, and a stale anchor costs a full prefix rewrite.
  if (params.finalizeClaudeCache) anchorClaudeCache(body);

  return { translatedBody: body, pxpipeSummary };
}

// ---------------------------------------------------------------------------
// Request summary log line
// ---------------------------------------------------------------------------

export function logRequestSummary(params: {
  log?: ChatLogger;
  reqTag: string;
  clientRawRequest?: ClientRawRequest;
  body: Record<string, unknown>;
  translatedBody: Record<string, unknown>;
  passthrough: boolean;
  sourceFormat: string;
  targetFormat: string;
  provider: string;
  model: string;
  stream: boolean;
  credentials: ChatCredentials;
}): void {
  const { log, reqTag, clientRawRequest, body, translatedBody, passthrough, sourceFormat, targetFormat, provider, model, stream, credentials } = params;
  // Request line: one correlated summary (fmt + thinking + counts + account)
  if (log?.line) {
    const clientModel = clientRawRequest?.body?.model || `${provider}/${model}`;
    const msgN = (translatedBody as Record<string, unknown>).messages && ((translatedBody as Record<string, unknown>).messages as unknown[]).length || (translatedBody as Record<string, unknown>).input && ((translatedBody as Record<string, unknown>).input as unknown[]).length || (translatedBody as Record<string, unknown>).contents && ((translatedBody as Record<string, unknown>).contents as unknown[]).length || (body.messages as unknown[])?.length || (body.input as unknown[])?.length || 0;
    const toolN = ((translatedBody as Record<string, unknown>).tools as unknown[])?.length || (body.tools as unknown[])?.length || 0;
    const fmtStr = passthrough ? `FMT: ${sourceFormat} (passthrough)` : `FMT: ${sourceFormat}→${targetFormat}`;
    const showThinking = provider !== "grok-cli" || supportsGrokCliReasoningEffort(model);
    const think = showThinking ? log.fmtThink?.(extractThinking(translatedBody)) : null;
    const acc = credentials?.connectionName || credentials?.connectionId?.slice(0, 8) || "-";
    const parts = [
      `POST ${clientModel} → ${provider}/${model}`,
      fmtStr,
      stream ? "STREAM" : "JSON",
      `${msgN} MSG`,
    ];
    if (toolN) parts.push(`${toolN} TOOL`);
    if (think) parts.push(`THINK:${think}`);
    parts.push(`ACC:${acc}`);
    log.line(reqTag, "▶", parts.join(" · "));
  }
}

// ---------------------------------------------------------------------------
// TTS body cleanup
// ---------------------------------------------------------------------------

export function applyTtsCleanup(params: { alias: string; model: string; translatedBody: Record<string, unknown> }): void {
  // TTS models don't support tool messages/function calling or system instructions
  if (getModelType(params.alias, params.model) === "tts") {
    const translatedBody = params.translatedBody;
    if (translatedBody.messages) {
      translatedBody.messages = (translatedBody.messages as Record<string, unknown>[]).filter((msg: Record<string, unknown>) => msg.role !== "tool");
    }
    delete translatedBody.tools;
    delete translatedBody.systemInstruction;
    delete translatedBody.system_instruction;
  }
}

// ---------------------------------------------------------------------------
// Proxy logging
// ---------------------------------------------------------------------------

export function logProxyOptions(params: {
  proxyOptions: Record<string, unknown>;
  credentials: ChatCredentials;
  provider: string;
  model: string;
  log?: ChatLogger;
}): void {
  const { proxyOptions, credentials, provider, model, log } = params;
  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl as string;
    try {
      const parsed = new URL(String(maskedProxyUrl));
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }
}

export { handleExecutionError, attemptTokenRefresh, handleUpstreamError } from "./upstreamErrors";
