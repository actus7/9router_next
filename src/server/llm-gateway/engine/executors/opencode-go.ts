import crypto from "crypto";
import { DefaultExecutor } from "./default";
import { resolveSessionId } from "../utils/sessionManager";
import type { Credentials } from "../services/types";

/**
 * OpenCode Go rejects generation traffic without a session
 * (`400 MissingSessionID`) — it routes and prompt-caches by it. Official
 * contract (opencode.ai/docs/go): a stable session id per conversation in
 * `x-opencode-session`; native client sessions pass through when well-formed
 * (non-empty, at most 256 chars), anything else is translated into the shape
 * the gate accepts (`ses_` + 32 hex).
 */
const SESSION_HEADER = "x-opencode-session";
const MAX_SESSION_LENGTH = 256;

function normalizeSession(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

function nativeSession(rawHeaders: Record<string, unknown> | null | undefined): string | null {
  if (!rawHeaders || typeof rawHeaders !== "object") return null;
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (key.toLowerCase() === SESSION_HEADER) return normalizeSession(value);
  }
  return null;
}

/** Stable per-conversation session in the shape the Go gate expects. */
function translatedSession(sessionId: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`opencode-go\0generic\0${sessionId}`)
    .digest("hex")
    .slice(0, 32);
  return `ses_${digest}`;
}

export class OpenCodeGoExecutor extends DefaultExecutor {
  private _opencodeGoSession: string | null = null;

  constructor() {
    super("opencode-go");
  }

  resolveSession(credentials: Credentials, body?: Record<string, unknown>): string {
    const rawHeaders = (credentials?.rawHeaders ?? null) as Record<string, unknown> | null;
    const native = nativeSession(rawHeaders);
    if (native) return native;
    let resolved = "";
    try {
      resolved = resolveSessionId({
        headers: (rawHeaders ?? undefined) as Record<string, unknown> | undefined,
        body,
        connectionId: (credentials?.connectionId || credentials?.id) as string | undefined,
        scope: "opencode-go",
      });
    } catch {
      resolved = "";
    }
    return translatedSession(resolved || String(credentials?.connectionId || credentials?.id || "default"));
  }

  // transformRequest runs before buildHeaders inside BaseExecutor.execute with
  // no await between the two (same atomicity the Codex executor relies on), so
  // the body-aware per-conversation session can be staged here.
  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Credentials) {
    const out = super.transformRequest(model, body, stream, credentials);
    this._opencodeGoSession = this.resolveSession(credentials, out as Record<string, unknown>);
    return out;
  }

  buildHeaders(credentials: Credentials, stream = true, url?: string, model?: string) {
    const headers = super.buildHeaders(credentials, stream, url, model);
    headers[SESSION_HEADER] = this._opencodeGoSession || this.resolveSession(credentials);
    return headers;
  }
}
