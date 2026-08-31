// Microsoft 365 Copilot (BizChat / Substrate) SignalR-over-WebSocket framing.
// Pure, transport-free helpers translating between the OpenAI chat shape and
// the Substrate BizChat SignalR JSON protocol. Ported from OmniRoute's
// copilot-m365-frames.ts, dropping the client-tool/plugin routing layer
// (parseFencedToolCalls, parseToolRouterDecision, clientPlugins) — this
// codebase has no generic tool-calling emulation for webCookie providers,
// consistent with every other provider ported this session.

type JsonRecord = Record<string, unknown>;

/** SignalR record separator (0x1e) terminating every JSON frame. */
export const RECORD_SEPARATOR = String.fromCharCode(0x1e);

export const HANDSHAKE_REQUEST = { protocol: "json", version: 1 } as const;
export const KEEPALIVE_PING = { type: 6 } as const;

export const ALLOWED_MESSAGE_TYPES = [
  "Chat", "Suggestion", "InternalSearchQuery", "Disengaged", "InternalLoaderMessage", "Progress",
  "GeneratedCode", "RenderCardRequest", "AdsQuery", "SemanticSerp", "GenerateContentQuery",
  "GenerateGraphicArt", "SearchQuery", "ConfirmationCard", "AuthError", "DeveloperLogs",
  "TriggerPlugin", "HintInvocation", "MemoryUpdate", "EndOfRequest", "TriggerConfirmation",
  "ResumeInvokeAction", "ResumeUserInputRequest", "TriggerUserInputRequest", "EscapeHatch",
  "TriggerPluginAuth", "ResumePluginAuth", "SideBySide", "ReferencesListComplete", "SwitchRespondingEndpoint",
] as const;

export const M365_ENTERPRISE_OPTION_SETS = [
  "enterprise_flux_image", "enterprise_flux_web", "enterprise_flux_work", "enterprise_toolbox_with_skdsstore",
  "enterprise_pagination_support", "enterprise_flux_work_code_interpreter", "enterprise_code_interpreter_citation_fix",
  "bizchat_enable_federated_connectors", "at_mention_plugins_enable",
] as const;

export const M365_ENTERPRISE_EXTRA_MESSAGE_TYPES = [
  "ReferencesListComplete", "EndOfRequest", "MemoryUpdate", "TriggerPlugin", "AuthError", "SwitchRespondingEndpoint",
] as const;

export const M365_DEFAULT_OPTION_SETS = [
  "search_result_progress_messages_with_search_queries", "update_textdoc_response_after_streaming",
  "deepleo_networking_timeout_10minutes_canmore", "cwc_flux_image", "cwc_code_interpreter",
  "cwc_code_interpreter_amsfix", "cwcfluxgptv", "flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch",
  "gptvnorm2048", "cwc_code_interpreter_citation_fix", "code_interpreter_interactive_charts",
  "cwc_code_interpreter_interactive_charts_inline_image", "code_interpreter_matplotlib_patching",
  "cwc_fileupload_odb", "update_memory_plugin", "add_custom_instructions", "cwc_flux_v3",
  "flux_v3_progress_messages", "enable_batch_token_processing", "enable_gg_gpt", "async_client_interaction",
  "flux_v3_references", "flux_v3_references_entities", "flux_v3_references_ci", "add_filestore_filetype",
  "cwc_code_interpreter_citation_sourceannotations", "cdxcwc_code_interpreter_hallucinated_url_filter",
  "flux_v3_image_gen_enable_dimensions", "flux_v3_image_gen_enable_non_watermarked_storage",
  "flux_v3_image_gen_enable_icon_dimensions", "flux_v3_image_gen_enable_system_text_with_params",
  "flux_v3_image_gen_enable_designer_dimensions_meta_prompting_in_system_prompts",
  "flux_v3_image_gen_enable_story", "rich_responses",
] as const;

export function encodeFrame(obj: unknown): string {
  return JSON.stringify(obj) + RECORD_SEPARATOR;
}
export function handshakeFrame(): string {
  return encodeFrame(HANDSHAKE_REQUEST);
}
export function keepaliveFrame(): string {
  return encodeFrame(KEEPALIVE_PING);
}

/** The browser follows the type:4 chat invocation with this type:1 target:"Metrics"
 * frame in the SAME socket write — an invocation without it is silently dropped. */
export const CHAT_METRICS_FRAME = {
  arguments: [{ Timestamps: { ConnectionEstablished: "", ConnectionStart: "", UserInputStart: "", UserInputSubmit: "" } }],
  target: "Metrics",
  type: 1,
} as const;
export function metricsFrame(): string {
  return encodeFrame(CHAT_METRICS_FRAME);
}

/** Split a raw socket buffer into complete `\x1e`-terminated frames, returning any
 * trailing partial frame as `rest` so it can be prepended to the next chunk. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(RECORD_SEPARATOR);
  const rest = parts.pop() ?? "";
  const frames = parts.filter((p) => p.length > 0);
  return { frames, rest };
}

export function parseFrame(frame: string): Record<string, unknown> | null {
  const trimmed = frame.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A SignalR handshake response is `{}` on success, or `{ error: "..." }` on failure. */
export function handshakeError(frame: Record<string, unknown> | null): string | null {
  if (!frame) return null;
  const err = frame.error;
  return typeof err === "string" && err.length > 0 ? err : null;
}

export interface ChatInvocationOptions {
  text: string;
  traceId: string;
  clientCorrelationId?: string;
  sessionId: string;
  requestId: string;
  conversationId: string;
  locale?: string;
  timeZone?: string;
  timeZoneOffset?: number;
  isStartOfSession?: boolean;
  optionsSets?: string[];
  tone?: string;
  allowedMessageTypes?: readonly string[];
  disconnectBehavior?: string;
}

export function resolveChatInvocationOverrides(tier: string | undefined): {
  optionsSets: string[];
  tone: string;
  allowedMessageTypes: readonly string[];
  disconnectBehavior: string | undefined;
} {
  if (tier === "enterprise") {
    return {
      optionsSets: [...M365_ENTERPRISE_OPTION_SETS],
      tone: "Magic",
      allowedMessageTypes: [...ALLOWED_MESSAGE_TYPES, ...M365_ENTERPRISE_EXTRA_MESSAGE_TYPES],
      disconnectBehavior: "continue",
    };
  }
  return {
    optionsSets: [...M365_DEFAULT_OPTION_SETS],
    tone: "Magic",
    allowedMessageTypes: ALLOWED_MESSAGE_TYPES,
    disconnectBehavior: "continue",
  };
}

/** BizChat exposes several models via the `tone` field of the type:4 invocation. */
export const M365_MODEL_TONE_MAP: Readonly<Record<string, string>> = {
  "copilot-m365-claude-opus": "Claude_Opus",
  "copilot-m365-gpt-5-6-reasoning": "Gpt_5_6_Reasoning",
  "copilot-m365-gpt-5-5-chat": "Gpt_5_5_Chat",
};

export function resolveToneForModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return M365_MODEL_TONE_MAP[model];
}

export function buildChatInvocation(opts: ChatInvocationOptions): Record<string, unknown> {
  const clientInfo = {
    clientAppName: "Office",
    clientPlatform: "mcmcopilot-web",
    clientEntrypoint: "mcmcopilot-officeweb",
    clientSessionId: opts.sessionId,
    ProductCategory: "Chat",
    clientAppType: "Web",
    productEntryPoint: "ChatPanel",
    deviceOS: "Windows",
    deviceType: "Desktop",
    clientPlatformVersion: "10",
  };

  return {
    type: 4,
    target: "chat",
    invocationId: "0",
    arguments: [
      {
        allowedMessageTypes: opts.allowedMessageTypes ? [...opts.allowedMessageTypes] : [...ALLOWED_MESSAGE_TYPES],
        clientCorrelationId: opts.clientCorrelationId ?? opts.traceId,
        clientInfo,
        conversationId: opts.conversationId,
        extraExtensionParameters: {},
        isStartOfSession: opts.isStartOfSession ?? true,
        message: {
          adaptiveCards: [],
          attachments: null,
          author: "user",
          clientInfo,
          clientPreferences: {},
          connectedFederatedConnections: ["dummyId"],
          entityAnnotationTypes: ["People", "File", "Event", "Email", "TeamsMessage"],
          experienceType: "Default",
          inputMethod: "Keyboard",
          locale: opts.locale ?? "en-us",
          locationInfo: { timeZone: opts.timeZone ?? "UTC", timeZoneOffset: opts.timeZoneOffset ?? 0 },
          messageType: "Chat",
          requestId: opts.requestId,
          text: opts.text,
        },
        isSbsSupported: true,
        options: {},
        optionsSets: opts.optionsSets ?? [...M365_DEFAULT_OPTION_SETS],
        plugins: [{ Id: "BingWebSearch", Source: "BuiltIn" }],
        productThreadType: "Office",
        renderReferencesBehindEOS: true,
        sessionId: opts.sessionId,
        sliceIds: [],
        source: "officeweb",
        streamingMode: "ConciseWithPadding",
        threadLevelGptId: {},
        tone: opts.tone ?? "Magic",
        toolChoice: null,
        traceId: opts.traceId,
        disconnectBehavior: opts.disconnectBehavior ?? "continue",
      },
    ],
  };
}

export function isUpdateFrame(frame: Record<string, unknown> | null): boolean {
  return !!frame && frame.type === 1 && frame.target === "update";
}
export function isCompletionFrame(frame: Record<string, unknown> | null): boolean {
  return !!frame && frame.type === 3;
}

export function extractCompletionError(frame: Record<string, unknown> | null): string | null {
  if (!frame || frame.type !== 3) return null;
  const error = frame.error;
  if (!error || typeof error !== "object") return null;
  const message = (error as JsonRecord).message;
  return typeof message === "string" && message.length > 0 ? message : JSON.stringify(error);
}

function isToolProgressMessage(m: Record<string, unknown>): boolean {
  if (m.messageType === "Progress") return true;
  const ct = m.contentType;
  return ct === "SearchResults" || ct === "Code" || ct === "ToolCall" || ct === "EarlyProgress";
}

function isToolProgressFrame(frame: Record<string, unknown> | null): boolean {
  if (!isUpdateFrame(frame)) return false;
  const args = (frame as Record<string, unknown>).arguments;
  const first = Array.isArray(args) ? (args[0] as Record<string, unknown> | undefined) : undefined;
  const messages = first?.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => !!m && typeof m === "object" && isToolProgressMessage(m as Record<string, unknown>));
}

function extractBotText(frame: Record<string, unknown> | null): string | null {
  if (!isUpdateFrame(frame)) return null;
  const args = (frame as Record<string, unknown>).arguments;
  const first = Array.isArray(args) ? (args[0] as Record<string, unknown> | undefined) : undefined;
  const messages = first?.messages;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m) continue;
    const author = m.author;
    const text = m.text;
    if (isToolProgressMessage(m)) continue;
    if ((author === "bot" || author === undefined) && typeof text === "string" && text.length > 0) return text;
  }
  return null;
}

/** BizChat update frames carry the FULL accumulated answer each time, not a delta. */
function incrementalDelta(previous: string, next: string): string {
  if (!next) return "";
  if (next === previous) return "";
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

function extractWriteAtCursor(frame: Record<string, unknown> | null): string | null {
  if (!isUpdateFrame(frame)) return null;
  const args = (frame as Record<string, unknown>).arguments;
  const first = Array.isArray(args) ? (args[0] as Record<string, unknown> | undefined) : undefined;
  const wac = first?.writeAtCursor;
  return typeof wac === "string" && wac.length > 0 ? wac : null;
}

/** Last-resort fallback: some EDU turns only surface the answer in the type:2 result. */
export function extractFinalResultMessage(frame: Record<string, unknown> | null): string | null {
  if (!frame || frame.type !== 2) return null;
  const item = frame.item as Record<string, unknown> | undefined;
  const result = item?.result as Record<string, unknown> | undefined;
  const message = result?.message;
  return typeof message === "string" && message.length > 0 ? message : null;
}

/** Fold a single incoming frame into the running bot answer. */
export function accumulateBotContent(previous: string, frame: Record<string, unknown> | null): { delta: string; next: string } {
  if (isToolProgressFrame(frame)) return { delta: "", next: previous };
  const snapshot = extractBotText(frame);
  if (snapshot) return { delta: incrementalDelta(previous, snapshot), next: snapshot };
  const wac = extractWriteAtCursor(frame);
  if (wac) return { delta: wac, next: previous + wac };
  return { delta: "", next: previous };
}
