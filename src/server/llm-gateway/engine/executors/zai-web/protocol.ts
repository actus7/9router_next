// Z.ai (chat.z.ai) signed-API protocol — reverse-engineered from the site's own
// frontend network calls. Ported from OmniRoute's zai-web/protocol.ts (the
// browser-automation fallback path was intentionally left out; this project
// requires a captcha_verify_param supplied by the user instead).

import { createHmac, randomUUID } from "node:crypto";

const ZAI_BASE_URL = "https://chat.z.ai";
export const ZAI_NEW_CHAT_URL = `${ZAI_BASE_URL}/api/v1/chats/new`;
// The unversioned /api/chat/completions path 404s model-independently — the
// site moved to /api/v2 (see registry notice for zai-web).
export const ZAI_CHAT_URL = `${ZAI_BASE_URL}/api/v2/chat/completions`;
export const ZAI_DEFAULT_MODEL = "GLM-5.1";
export const ZAI_DEFAULT_FE_VERSION = "prod-fe-1.1.79";
export const ZAI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
export const ZAI_FE_VERSION_CACHE_TTL_MS = 15 * 60 * 1000;

const CLIENT_PROTOCOL_VERSION = "0.0.1";
const SIGNATURE_KEY = "key-@@@@)))()((9))-xxxx&&&%%%%%";
const MAX_ERROR_LEN = 500;

export type ZaiReasoningEffort = "high" | "max";

export interface ZaiThinkingConfig {
  enabled: boolean;
  effort: ZaiReasoningEffort;
  effortSupported: boolean;
  supported: boolean;
}

interface ZaiModelCapabilities {
  reasoningEffort: boolean;
  thinking: boolean;
  webSearch: boolean;
}

const NO_ZAI_MODEL_CAPABILITIES: ZaiModelCapabilities = Object.freeze({
  reasoningEffort: false,
  thinking: false,
  webSearch: false,
});

/** Verified against chat.z.ai/api/models (prod-fe-1.1.79). Vision models (glm-5v-turbo)
 * are excluded — they need image upload, which only the browser transport supports. */
const ZAI_MODEL_CAPABILITIES: Record<string, ZaiModelCapabilities> = {
  "glm-5.2": { reasoningEffort: true, thinking: true, webSearch: true },
  "glm-5.1": { reasoningEffort: false, thinking: true, webSearch: true },
  "glm-5-turbo": { reasoningEffort: false, thinking: true, webSearch: true },
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Truncate to one line and cap length — keeps upstream error bodies from
 * leaking stack traces/paths back to the API caller. */
export function sanitizeErrorMessage(message: unknown): string {
  let str = typeof message === "string" ? message : String(message ?? "");
  if (str.length > MAX_ERROR_LEN) str = str.slice(0, MAX_ERROR_LEN);
  const nl = str.indexOf("\n");
  return nl >= 0 ? str.slice(0, nl) : str;
}

function normalizeCookie(raw: string): string {
  return raw?.startsWith("Cookie:") ? raw.slice(7).trim() : raw || "";
}

function parseCredentialJson(raw: string): Record<string, unknown> | null {
  if (!raw.trim().startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Extract the localStorage Bearer token, accepting several paste formats
 * (raw JSON, "Bearer x", cookie-style "token=x", or a bare string). */
export function extractZaiToken(rawCredential: string): string {
  const trimmed = rawCredential.trim();
  const json = parseCredentialJson(trimmed);
  if (json) {
    const token = json.token ?? json.accessToken ?? json.access_token;
    return typeof token === "string" ? token.trim() : "";
  }

  const bearer = trimmed.match(/^(?:Authorization:\s*)?Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();

  const normalized = normalizeCookie(trimmed);
  if (!normalized) return "";
  const match = normalized.match(/(?:^|;\s*)token=([^;]+)/);
  if (match) return match[1].trim();
  return normalized.includes(";") || normalized.includes("=") ? "" : normalized;
}

/** Read the short-lived CAPTCHA proof (captured by the user from a real chat.z.ai
 * network request — there is no browser here to mint one automatically). */
export function extractZaiCaptchaVerifyParam(value: unknown): string {
  const record = asRecord(value);
  if (record) {
    const direct =
      record.captcha_verify_param ?? record.captchaVerifyParam ?? record.zaiCaptchaVerifyParam;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const nested = asRecord(record.providerSpecificData);
    if (nested) return extractZaiCaptchaVerifyParam(nested);
    return "";
  }

  if (typeof value !== "string") return "";
  const json = parseCredentialJson(value);
  if (json) return extractZaiCaptchaVerifyParam(json);
  const match = value.match(/(?:^|;\s*)captcha_verify_param=([^;]+)/);
  return match?.[1]?.trim() ?? "";
}

export function resolveZaiCaptchaVerifyParam(
  credentials: { providerSpecificData?: unknown; apiKey?: string; accessToken?: string },
  body: Record<string, unknown>
): string {
  return (
    extractZaiCaptchaVerifyParam(body) ||
    extractZaiCaptchaVerifyParam(credentials.providerSpecificData) ||
    extractZaiCaptchaVerifyParam(credentials.apiKey) ||
    extractZaiCaptchaVerifyParam(credentials.accessToken)
  );
}

/** The JWT's payload carries the numeric user id the signature/URL need. */
export function extractZaiUserId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) return "";
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return typeof decoded?.id === "string" ? decoded.id : "";
  } catch {
    return "";
  }
}

export function buildZaiSignature(input: {
  prompt: string;
  requestId: string;
  timestamp: number | string;
  userId: string;
}): string {
  const timestamp = String(input.timestamp);
  const sortedPayload = Object.entries({
    timestamp,
    requestId: input.requestId,
    user_id: input.userId,
  })
    .sort(([left], [right]) => left.localeCompare(right))
    .join(",");
  const encodedPrompt = Buffer.from(input.prompt, "utf8").toString("base64");
  const bucket = Math.floor(Number(timestamp) / (5 * 60 * 1000));
  const derivedKey = createHmac("sha256", SIGNATURE_KEY).update(String(bucket)).digest("hex");
  return createHmac("sha256", derivedKey)
    .update(`${sortedPayload}|${encodedPrompt}|${timestamp}`)
    .digest("hex");
}

export function parseZaiFrontendVersion(html: string): string | null {
  return html.match(/\/frontend\/(prod-fe-\d+(?:\.\d+)*)\/assets\//)?.[1] ?? null;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const record = asRecord(part);
      if (!record || (record.type !== "text" && record.type !== "input_text")) return [];
      const text = record.text ?? record.content;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

export function latestUserPrompt(messages: Array<{ role: string; content: unknown }>): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role !== "user") continue;
    return textContent(messages[index].content);
  }
  return "";
}

export function foldMessages(
  messages: Array<{ role: string; content: unknown }>
): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: textContent(message.content),
  }));
}

export function unprefixedModelId(modelId: string): string {
  return modelId.trim().split("/").at(-1) || modelId.trim();
}

function getZaiModelCapabilities(modelId: string): ZaiModelCapabilities {
  return (
    ZAI_MODEL_CAPABILITIES[unprefixedModelId(modelId).toLowerCase()] ?? NO_ZAI_MODEL_CAPABILITIES
  );
}

/** Resolve each model's Deep Think control; only GLM-5.2 accepts High/Max effort. */
export function resolveZaiThinkingConfig(
  modelId: string,
  body: Record<string, unknown>
): ZaiThinkingConfig {
  const capabilities = getZaiModelCapabilities(modelId);
  const supported = capabilities.thinking;
  const reasoning = asRecord(body.reasoning);
  const rawEffort =
    typeof body.reasoning_effort === "string"
      ? body.reasoning_effort.trim().toLowerCase()
      : typeof reasoning?.effort === "string"
        ? reasoning.effort.trim().toLowerCase()
        : "";
  const disabled = body.enable_thinking === false || rawEffort === "none" || rawEffort === "off";
  const effort: ZaiReasoningEffort =
    rawEffort === "low" || rawEffort === "medium" || rawEffort === "high" ? "high" : "max";

  return {
    supported,
    enabled: supported && !disabled,
    effort,
    effortSupported: capabilities.reasoningEffort,
  };
}

/** Whether this model's Web Search toggle should be sent enabled. */
export function resolveZaiWebSearch(modelId: string, body: Record<string, unknown>): boolean {
  const capabilities = getZaiModelCapabilities(modelId);
  if (!capabilities.webSearch) return false;
  const option = body.auto_web_search ?? body.web_search;
  return option === true || option === undefined;
}

export function buildZaiHeaders(
  token: string,
  options: {
    accept: "application/json" | "text/event-stream";
    frontendVersion?: string;
    signature?: string;
  }
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: options.accept,
    "Accept-Language": "en-US",
    "User-Agent": ZAI_USER_AGENT,
    Origin: ZAI_BASE_URL,
    Referer: `${ZAI_BASE_URL}/`,
    Authorization: `Bearer ${token}`,
  };
  if (options.frontendVersion) headers["X-FE-Version"] = options.frontendVersion;
  if (options.signature) headers["X-Signature"] = options.signature;
  return headers;
}

export function buildZaiCompletionUrl(input: {
  requestId: string;
  timestamp: number;
  token: string;
  userId: string;
}): string {
  const now = new Date(input.timestamp);
  const params = new URLSearchParams({
    timestamp: String(input.timestamp),
    requestId: input.requestId,
    user_id: input.userId,
    version: CLIENT_PROTOCOL_VERSION,
    platform: "web",
    token: input.token,
    user_agent: ZAI_USER_AGENT,
    language: "en-US",
    languages: "en-US,en",
    timezone: "UTC",
    cookie_enabled: "true",
    screen_width: "1280",
    screen_height: "800",
    screen_resolution: "1280x800",
    viewport_height: "800",
    viewport_width: "1280",
    viewport_size: "1280x800",
    color_depth: "24",
    pixel_ratio: "1",
    current_url: `${ZAI_BASE_URL}/`,
    pathname: "/",
    search: "",
    hash: "",
    host: "chat.z.ai",
    hostname: "chat.z.ai",
    protocol: "https:",
    referrer: "",
    title: "Z.ai - Advanced AI Chatbot & Agent powered by GLM-5.2",
    timezone_offset: "0",
    local_time: now.toISOString(),
    utc_time: now.toUTCString(),
    is_mobile: "false",
    is_touch: "false",
    max_touch_points: "0",
    browser_name: "Chrome",
    os_name: "Mac OS",
    signature_timestamp: String(input.timestamp),
  });
  return `${ZAI_CHAT_URL}?${params.toString()}`;
}

export function buildZaiNewChatBody(
  messages: Array<{ role: string; content: unknown }>,
  modelId: string,
  enableThinking: boolean,
  reasoningEffort: ZaiReasoningEffort,
  webSearchEnabled: boolean
) {
  const prompt = latestUserPrompt(messages);
  const userMessageId = randomUUID();
  return {
    userMessageId,
    payload: {
      chat: {
        id: "",
        title: "New Chat",
        models: [modelId],
        params: {},
        history: {
          messages: {
            [userMessageId]: {
              id: userMessageId,
              parentId: null,
              childrenIds: [],
              role: "user",
              content: prompt,
              timestamp: Math.floor(Date.now() / 1000),
              models: [modelId],
            },
          },
          currentId: userMessageId,
        },
        tags: [],
        flags: [],
        features: [{ server: "tool_selector_h", status: "hidden", type: "tool_selector" }],
        mcp_servers: [],
        enable_thinking: enableThinking,
        reasoning_effort: reasoningEffort,
        auto_web_search: webSearchEnabled,
        message_version: 1,
        timestamp: Date.now(),
        type: "default",
      },
    },
  };
}

export function buildZaiRequestBody(input: {
  body: Record<string, unknown>;
  captchaVerifyParam: string;
  chatId: string;
  messages: Array<{ role: string; content: unknown }>;
  modelId: string;
  prompt: string;
  userMessageId: string;
  enableThinking: boolean;
  reasoningEffort: ZaiReasoningEffort;
  reasoningEffortSupported: boolean;
  webSearchEnabled: boolean;
}): Record<string, unknown> {
  const params = Object.fromEntries(
    ["temperature", "top_p", "max_tokens", "stop"]
      .filter((key) => input.body[key] !== undefined)
      .map((key) => [key, input.body[key]])
  );
  const features: Record<string, unknown> = {
    image_generation: false,
    web_search: false,
    auto_web_search: input.webSearchEnabled,
    preview_mode: true,
    flags: [],
    enable_thinking: input.enableThinking,
  };
  if (input.enableThinking && input.reasoningEffortSupported) {
    features.reasoning_effort = input.reasoningEffort;
  }
  return {
    stream: true,
    model: input.modelId,
    messages: foldMessages(input.messages),
    signature_prompt: input.prompt,
    params,
    features,
    variables: {},
    chat_id: input.chatId,
    id: randomUUID(),
    current_user_message_id: input.userMessageId,
    current_user_message_parent_id: null,
    background_tasks: { title_generation: true, tags_generation: true },
    captcha_verify_param: input.captchaVerifyParam,
  };
}
