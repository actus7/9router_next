// Microsoft 365 Copilot (individual / Substrate BizChat) connection helpers.
// Ported from OmniRoute's copilot-m365-connection.ts. Drops the OAuth
// refresh-token exchange (needs a public client id/secret registry this
// codebase doesn't have) and the tool-routing prompt layer — consistent with
// every other webCookie provider ported this session, which all surface an
// expired credential as a re-paste-it error instead of auto-refreshing.

import { randomUUID, randomBytes } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export const M365_INDIVIDUAL_DEFAULTS = {
  host: "substrate.office.com",
  source: "officeweb",
  product: "Office",
  agentHost: "Bizchat.FullScreen",
  licenseType: "Starter",
  agent: "web",
  scenario: "OfficeWebPaidConsumerCopilot",
} as const;

export const M365_EDU_OVERRIDES = {
  scenario: "OfficeWebIncludedCopilot",
  isEdu: "true",
  licenseType: "Starter",
} as const;

export const M365_ENTERPRISE_OVERRIDES = {
  agent: "work",
  scenario: "officeweb",
  licenseType: "Premium",
} as const;

export const M365_DEFAULT_VARIANTS = [
  "EnableMcpServerWidgets", "feature.EnableMcpServerWidgets", "feature.EnableLuForChatCIQ", "feature.enableChatCIQPlugin",
  "EnableRequestPlugins", "feature.EnableSensitivityLabels", "EnableUnsupportedUrlDetector",
  "feature.IsCustomEngineCopilotEnabled", "feature.bizchatfluxv3", "feature.enablechatpages", "feature.enableCodeCanvas",
  "feature.turnOnDARecommendation", "feature.IsStreamingModeInChatRequestEnabled", "IncludeSourceAttributionsConcise",
  "SkipPublishEmptyMessage", "feature.EnableDeduplicatingSourceAttributions", "Enable3PActionProgressMessages",
  "feature.enableClientWebRtc", "feature.EnableMeetingRecapOfSeriesMeetingWithCiq", "feature.cwcfluxv3fe",
  "feature.cwcfluxv3fem", "feature.EnableReferencesListCompleteSignal", "feature.StorageMessageSplitDisabled",
  "feature.EnableCuaTakeControlApi", "SingletonEnvOn", "EnableComposeWidget", "feature.cwcallowedos",
  "feature.EnableMergingPureDeltas", "feature.disabledisallowedmsgs", "feature.enableCitationsForSynthesisData",
  "feature.EnableConversationShareApis", "feature.enableGenerateGraphicArtOptionsSet", "cdximagen",
  "feature.EnableUpdatedUXForConfirmationDialog", "feature.EnableContentApiandDocTypeHtmlInRichAnswers",
  "cdxgrounding_api_v2_rich_web_answers_reference_bottom_force", "cdxenablerenderforisocomp",
  "feature.EnableClientFileURLSupportForOfficeWebPaidCopilot", "feature.EnableDesignEditorImageGrounding",
  "feature.EnableDesignerEditor", "feature.EnableSkipRehydrationForSpeCIdImages", "feature.EnablePersonalizationForMSA",
  "agt_bizchat_enableRichResponses", "feature.EnableBase64DataInMessageAnnotations", "feature.EnableSkipEmittingMessageOnFlush",
  "feature.EnableRemoveEmptySourceAttributions", "feature.EnableRemoveStreamingMode",
] as const;

export interface M365ConnectionParams {
  host: string;
  chathubPath: string; // "<user-oid>@<tenant-id>"
  accessToken: string;
  variants?: string;
  scenario?: string;
  isEdu?: string;
  licenseType?: string;
  agent?: string;
  tier?: "edu" | "enterprise";
}

/** A new 32-hex chat session id (== XRoutingParameterSessionKey == clientrequestid). */
export function newChatSessionId(): string {
  return randomBytes(16).toString("hex");
}

function parsePastedCredential(raw: string): Partial<Pick<M365ConnectionParams, "accessToken" | "chathubPath">> {
  const value = raw.trim();
  const parts: Record<string, string> = {};

  for (const segment of value.split(/[;\n]/)) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const key = segment.slice(0, separator).trim();
    const partValue = segment.slice(separator + 1).trim();
    if (key && partValue) parts[key] = partValue;
  }

  if (/^wss:\/\/substrate\.office\.com\/m365Copilot\/Chathub\//i.test(value)) {
    try {
      const url = new URL(value);
      parts.access_token ||= url.searchParams.get("access_token") || "";
      parts.chathubPath ||= decodeURIComponent(url.pathname.split("/m365Copilot/Chathub/")[1] || "");
    } catch {
      // Keep any key/value fields already parsed from the pasted text.
    }
  }

  return {
    accessToken: parts.access_token || parts.accessToken,
    chathubPath: parts.chathubPath || parts.userTenant,
  };
}

/** Read the pasted credential bits: the opaque access_token plus the Chathub
 * path (`user@tenant`), which is not derivable from the token. */
export function resolveConnectionParams(credentials: { apiKey?: string; providerSpecificData?: JsonRecord } | undefined): M365ConnectionParams | { error: string } {
  const psd = (credentials?.providerSpecificData ?? {}) as JsonRecord;
  const parsedApiKey = typeof credentials?.apiKey === "string" ? parsePastedCredential(credentials.apiKey) : {};
  const accessToken =
    parsedApiKey.accessToken ||
    (typeof credentials?.apiKey === "string" && credentials.apiKey && !credentials.apiKey.includes("access_token=") && credentials.apiKey) ||
    (typeof psd.accessToken === "string" && psd.accessToken) ||
    (typeof psd.access_token === "string" && psd.access_token) ||
    "";
  if (!accessToken) {
    return { error: "Missing M365 Copilot access_token. Paste it as the provider credential." };
  }
  const chathubPath =
    parsedApiKey.chathubPath ||
    (typeof psd.chathubPath === "string" && psd.chathubPath) ||
    (typeof psd.userTenant === "string" && psd.userTenant) ||
    "";
  if (!chathubPath || !chathubPath.includes("@")) {
    return { error: "Missing M365 Chathub path. Paste the '<user-oid>@<tenant-id>' segment from the WebSocket URL." };
  }
  const host = (typeof psd.host === "string" && psd.host) || M365_INDIVIDUAL_DEFAULTS.host;
  const variants = typeof psd.variants === "string" && psd.variants ? psd.variants : undefined;

  return { host, chathubPath, accessToken, variants, ...resolveTierOverrides(psd) };
}

function resolveTierOverrides(psd: JsonRecord): Pick<M365ConnectionParams, "scenario" | "isEdu" | "licenseType" | "agent" | "tier"> {
  const tier = typeof psd.tier === "string" ? psd.tier.toLowerCase() : "";
  const isEduTier = tier === "edu" || tier === "included";
  const isEnterpriseTier = tier === "enterprise" || tier === "work";
  const psdIsEdu = (typeof psd.isEdu === "string" && psd.isEdu) || (typeof psd.isEdu === "boolean" && String(psd.isEdu)) || undefined;
  return {
    scenario:
      (typeof psd.scenario === "string" && psd.scenario) ||
      (isEduTier ? M365_EDU_OVERRIDES.scenario : undefined) ||
      (isEnterpriseTier ? M365_ENTERPRISE_OVERRIDES.scenario : undefined),
    isEdu: psdIsEdu || (isEduTier ? M365_EDU_OVERRIDES.isEdu : undefined),
    licenseType:
      (typeof psd.licenseType === "string" && psd.licenseType) ||
      (isEduTier ? M365_EDU_OVERRIDES.licenseType : undefined) ||
      (isEnterpriseTier ? M365_ENTERPRISE_OVERRIDES.licenseType : undefined),
    agent: (typeof psd.agent === "string" && psd.agent) || (isEnterpriseTier ? M365_ENTERPRISE_OVERRIDES.agent : undefined),
    tier: isEduTier ? "edu" : isEnterpriseTier ? "enterprise" : undefined,
  };
}

/** Build the BizChat WebSocket URL. The access_token rides in the query string,
 * so callers must never log the returned URL verbatim — use redactWsUrl(). */
export function buildWsUrl(params: M365ConnectionParams): string {
  const sessionKey = newChatSessionId();
  const query = new URLSearchParams({
    chatsessionid: sessionKey,
    XRoutingParameterSessionKey: sessionKey,
    clientrequestid: sessionKey,
    "X-SessionId": randomUUID(),
    ConversationId: randomUUID(),
    access_token: params.accessToken,
    variants: params.variants ?? M365_DEFAULT_VARIANTS.join(","),
    source: M365_INDIVIDUAL_DEFAULTS.source,
    product: M365_INDIVIDUAL_DEFAULTS.product,
    agentHost: M365_INDIVIDUAL_DEFAULTS.agentHost,
    licenseType: params.licenseType ?? M365_INDIVIDUAL_DEFAULTS.licenseType,
    isEdu: params.isEdu ?? "false",
    agent: params.agent ?? M365_INDIVIDUAL_DEFAULTS.agent,
    scenario: params.scenario ?? M365_INDIVIDUAL_DEFAULTS.scenario,
  });
  return `wss://${params.host}/m365Copilot/Chathub/${params.chathubPath}?${query.toString()}`;
}

/** Strip the access_token from a WS URL so it is safe to log. */
export function redactWsUrl(wsUrl: string): string {
  return wsUrl.replace(/access_token=[^&]*/i, "access_token=REDACTED");
}

function compactToolResult(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && typeof (p as JsonRecord).text === "string" ? (p as JsonRecord).text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

/** Flatten the FULL OpenAI message history into a single bracketed prompt so
 * multi-turn context survives the fold into BizChat's single-text protocol. */
export function flattenMessages(body: JsonRecord | undefined): string {
  const messages = (body?.messages as Array<JsonRecord>) || [];
  const parts: string[] = [];
  for (const m of messages) {
    const role = typeof m.role === "string" ? m.role.toLowerCase().trim() : "user";
    const text = messageText(m.content).trim();
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      if (text) parts.push(`[${role}]\n${text}`);
      parts.push(`[${role} tool_calls]\n${JSON.stringify(m.tool_calls)}`);
      continue;
    }
    if (role === "tool") {
      const id = typeof m.tool_call_id === "string" ? m.tool_call_id : "";
      parts.push(`[tool result id=${id}]\n${compactToolResult(text)}`);
      continue;
    }
    if (!text) continue;
    parts.push(`[${role}]\n${text}`);
  }
  return parts.join("\n\n").trim();
}

/** Flatten OpenAI messages into a single prompt, nudging for a full (non-truncated) answer. */
export function buildPrompt(body: JsonRecord | undefined): string {
  return `Please answer the following request in full. Do not truncate or abbreviate your response.\n\n${flattenMessages(body)}`;
}
