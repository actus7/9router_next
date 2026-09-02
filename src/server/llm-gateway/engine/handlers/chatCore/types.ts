/**
 * Shared types for the chatCore handler family.
 * Defines interfaces for the request-context object that flows through
 * chatCore → sub-handlers (nonStreaming, streaming, sseToJson).
 */

// ---------------------------------------------------------------------------
// Primitive / config shapes
// ---------------------------------------------------------------------------

/** Logger facade injected by the caller (SSE handler or Worker). */
export interface ChatLogger {
  tagForSession?: (seed: string) => string;
  nextTag?: () => string;
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  line?: (...args: unknown[]) => void;
  errorLine?: (...args: unknown[]) => void;
  fmtThink?: (thinking: unknown) => string | null;
}

/** Raw client request metadata forwarded by the SSE/HTTP layer. */
export interface ClientRawRequest {
  endpoint?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Provider credentials object — mutable; executors/refresh mutate in-place. */
export interface ChatCredentials {
  accessToken?: string;
  refreshToken?: string;
  copilotToken?: string;
  apiKey?: string;
  connectionName?: string;
  connectionId?: string;
  runtimeTransport?: Record<string, unknown> | null;
  rawHeaders?: Record<string, string>;
  providerSpecificData?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Provider-level thinking config override. */
export interface ProviderThinkingConfig {
  mode?: string;
}

/** Model info resolved by the caller. */
export interface ModelInfo {
  provider: string;
  model: string;
}

/** Headroom diagnostics accumulator — mutated by compressWithHeadroom. */
export interface HeadroomDiagnostics {
  reason?: string;
  endpoint?: string;
  before?: Record<string, number>;
  after?: Record<string, number>;
  [key: string]: unknown;
}

/** PXPIPE summary returned by compressWithPxpipe. */
export interface PxpipeSummary {
  applied?: boolean;
  imageCount?: number;
  imageBytes?: number;
  [key: string]: unknown;
}

/** Stream controller returned by createStreamController. */
export interface StreamController {
  signal: AbortSignal;
  startTime: number;
  isConnected: () => boolean;
  handleDisconnect: (reason?: string) => void;
  handleComplete: () => void;
  handleError: (error: Error) => void;
}

/** Request logger returned by createRequestLogger. */
export interface RequestLogger {
  logClientRawRequest: (endpoint: string | undefined, body: unknown, headers: unknown) => void;
  logRawRequest: (body: unknown) => void;
  logTargetRequest: (url: string | undefined, headers: unknown, body: unknown) => void;
  logProviderResponse: (status: number, statusText: string, headers: unknown, body: unknown) => void;
  logConvertedResponse: (body: unknown) => void;
  logError: (error: Error, body: unknown) => void;
}

// ---------------------------------------------------------------------------
// Options / parameter shapes
// ---------------------------------------------------------------------------

/** Options for handleChatCore — the top-level orchestrator. */
export interface HandleChatCoreOptions {
  body: Record<string, unknown>;
  modelInfo: ModelInfo;
  credentials: ChatCredentials;
  log?: ChatLogger;
  onCredentialsRefreshed?: (creds: ChatCredentials) => void | Promise<void>;
  onRequestSuccess?: () => void | Promise<void>;
  onDisconnect?: (reason: string) => void;
  clientRawRequest?: ClientRawRequest;
  connectionId: string;
  userAgent?: string;
  apiKey?: string;
  ccFilterNaming?: unknown;
  rtkEnabled?: boolean;
  headroomEnabled?: boolean;
  headroomUrl?: string;
  headroomCompressUserMessages?: boolean;
  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  ponytailEnabled?: boolean;
  ponytailLevel?: string;
  synapseEnabled?: boolean;
  synapseLevel?: string;
  pxpipeEnabled?: boolean;
  pxpipeMinChars?: number;
  pxpipeTimeoutMs?: number;
  pxpipeTransform?: unknown;
  onPxpipeEvent?: (event: Record<string, unknown>) => void;
  sourceFormatOverride?: string;
  providerThinking?: ProviderThinkingConfig;
}

// ---------------------------------------------------------------------------
// Shared context — built in chatCore, spread into sub-handlers
// ---------------------------------------------------------------------------

/** Core context shared across all sub-handlers. */
export interface SharedChatContext {
  provider: string;
  model: string;
  body: Record<string, unknown>;
  stream: boolean;
  translatedBody: Record<string, unknown>;
  finalBody: Record<string, unknown> | undefined;
  requestStartTime: number;
  connectionId: string;
  apiKey: string | undefined;
  clientRawRequest: ClientRawRequest | undefined;
  onRequestSuccess: (() => void | Promise<void>) | undefined;
  pxpipe: PxpipeSummary | null;
  reqTag: string;
  log: ChatLogger | undefined;
}

/** Extended context for non-streaming handler. */
export interface NonStreamingHandlerContext extends SharedChatContext {
  providerResponse: Response;
  sourceFormat: string;
  targetFormat: string;
  reqLogger: RequestLogger;
  toolNameMap: Record<string, string> | undefined;
  customToolNames: Set<string> | undefined;
  trackDone: () => void;
  appendLog: (extra: Record<string, unknown>) => void;
}

/** Extended context for streaming handler. */
export interface StreamingHandlerContext extends SharedChatContext {
  providerResponse: Response;
  sourceFormat: string;
  targetFormat: string;
  userAgent: string | undefined;
  reqLogger: RequestLogger;
  toolNameMap: Record<string, string> | undefined;
  customToolNames: Set<string> | undefined;
  streamController: StreamController;
  onStreamComplete: (contentObj: Record<string, unknown>, usage: Record<string, unknown> | null, ttftAt: number | null) => void;
  streamDetailId: string;
}

/** Extended context for forced SSE→JSON handler. */
export interface ForcedSSEToJsonContext extends SharedChatContext {
  providerResponse: Response;
  sourceFormat: string;
  targetFormat: string;
  customToolNames: Set<string> | undefined;
  trackDone: () => void;
  appendLog: (extra: Record<string, unknown>) => void;
}

/** Context for buildOnStreamComplete. */
export interface OnStreamCompleteContext {
  provider: string;
  model: string;
  connectionId: string;
  apiKey: string | undefined;
  requestStartTime: number;
  body: Record<string, unknown>;
  stream: boolean;
  finalBody: Record<string, unknown> | undefined;
  translatedBody: Record<string, unknown>;
  clientRawRequest: ClientRawRequest | undefined;
  pxpipe: PxpipeSummary | null;
  reqTag: string;
  log: ChatLogger | undefined;
}

/** Context for buildTransformStream. */
export interface TransformStreamContext {
  provider: string;
  sourceFormat: string;
  targetFormat: string;
  userAgent: string | undefined;
  reqLogger: RequestLogger;
  toolNameMap: Record<string, string> | undefined;
  customToolNames: Set<string> | undefined;
  model: string;
  connectionId: string;
  body: Record<string, unknown>;
  onStreamComplete: (contentObj: Record<string, unknown>, usage: Record<string, unknown> | null, ttftAt: number | null) => void;
  apiKey: string | undefined;
}

// ---------------------------------------------------------------------------
// Request detail shapes
// ---------------------------------------------------------------------------

/** Latency breakdown. */
export interface LatencyInfo {
  ttft: number;
  total: number;
}

/** Token usage summary. */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  [key: string]: unknown;
}

/** Base fields for buildRequestDetail. */
export interface RequestDetailBase {
  provider?: string;
  model?: string;
  connectionId?: string;
  latency?: LatencyInfo;
  tokens?: TokenUsage;
  request?: Record<string, unknown>;
  providerRequest?: Record<string, unknown> | null;
  providerResponse?: unknown;
  response?: Record<string, unknown>;
  pxpipe?: PxpipeSummary | null;
  status?: string;
}

/** Overrides merged into the detail. */
export interface RequestDetailOverrides {
  id?: string;
  endpoint?: string | null;
  [key: string]: unknown;
}

/** Options for saveUsageStats. */
export interface SaveUsageStatsOptions {
  provider: string;
  model: string;
  tokens: TokenUsage | null;
  connectionId?: string;
  apiKey?: string;
  endpoint?: string;
  label?: string;
  silent?: boolean;
}
