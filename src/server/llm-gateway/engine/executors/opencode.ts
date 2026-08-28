import crypto from "crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { injectReasoningContent } from "../utils/reasoningContentInjector";
import { resolveSessionId } from "../utils/sessionManager";
import type { Credentials } from "../services/types";

const OPENCODE_UA = "opencode";
const MESSAGES_MODELS = new Set<string>();

function generateRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

// Normalize any resolved id into opencode's ses_ format (stable per-conversation)
function toOpencodeSession(id: string | null | undefined) {
  const stripped = String(id || "").replace(/^ses_/, "").replace(/-/g, "");
  return stripped ? `ses_${stripped}` : null;
}

function resolveOpencodeSession(body: Record<string, unknown>, credentials: Credentials) {
  return toOpencodeSession(resolveSessionId({
    headers: credentials?.rawHeaders as Record<string, string> | undefined,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode",
  }));
}

export class OpenCodeExecutor extends BaseExecutor {
  _currentSessionId: string | null;

  constructor() {
    super("opencode", PROVIDERS.opencode);
    this._currentSessionId = null;
  }

  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, credentials?: Credentials) {
    this._currentSessionId = resolveOpencodeSession(body, credentials!);
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model: string) {
    const base = this.config.baseUrl as string;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials: Credentials, stream = true) {
    const raw = (credentials?.rawHeaders || {}) as Record<string, string>;
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

    const downstreamUa = lower["user-agent"] || "";
    const isOpencodeDownstream = downstreamUa.toLowerCase().includes("opencode");

    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": lower["x-opencode-client"] || "desktop",
      "x-opencode-session": lower["x-opencode-session"] || this._currentSessionId || generateSessionId(),
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      "x-opencode-project": lower["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*",
    };
  }
}
