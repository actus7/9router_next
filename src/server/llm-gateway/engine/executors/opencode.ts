import crypto from "crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { MEMORY_CONFIG } from "../config/runtimeConfig";
import { ANTHROPIC_API_VERSION } from "../providers/shared";
import { injectReasoningContent } from "../utils/reasoningContentInjector";
import {
  applyFingerprintTools,
  recordRenamedToolNames,
} from "../utils/opencodeFingerprint";
import type { Credentials } from "../services/types";

/** Versioned UA the console.opencode.ai free-tier gate requires (>= 1.17.0). */
const OPENCODE_UA = "opencode/1.18.31";
const OPENCODE_MIN_VERSION = { major: 1, minor: 17 };
const MESSAGES_MODELS = new Set<string>();
const OPENCODE_ZEN_CHAT_PATH = "/zen/v1/chat/completions";
const OPENCODE_ZEN_MESSAGES_PATH = "/zen/v1/messages";
const ANTHROPIC_MESSAGES_SUFFIX = "/messages";

/** Canonical id shape the gate accepts: 12 lowercase hex + 14 base62 chars. */
export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const OPENCODE_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_RANDOM_LEN = 14;

/** Probe model for the free Zen catalogue (observed upstream id). */
const OPENCODE_ZEN_PROBE_MODEL = "big-pickle";

const MAX_STABLE_SESSIONS = 1000;

function hasValidOpencodeVersion(ua: unknown): boolean {
  const m = String(ua || "").match(/opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > OPENCODE_MIN_VERSION.major || (major === OPENCODE_MIN_VERSION.major && minor >= OPENCODE_MIN_VERSION.minor);
}

function unstableRandom(): string {
  const bytes = crypto.randomBytes(OPENCODE_RANDOM_LEN);
  let out = "";
  for (let i = 0; i < OPENCODE_RANDOM_LEN; i++) {
    out += OPENCODE_BASE62[bytes[i] % OPENCODE_BASE62.length];
  }
  return out;
}

let lastTimestamp = 0;
let counter = 0;

/** Canonical `ses_`/`msg_` id: timestamp-derived 12 hex + 14 base62 noise. */
function generateOpencodeId(prefix: string, timestamp = Date.now()): string {
  if (timestamp !== lastTimestamp) { lastTimestamp = timestamp; counter = 0; }
  counter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter);
  const value = ~current;
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn).toString(16).padStart(2, "0")).join("");
  return `${prefix}${time}${unstableRandom()}`;
}

function generateSessionId(timestamp = Date.now()) {
  return generateOpencodeId("ses_", timestamp);
}

function generateRequestId() {
  return generateOpencodeId("msg_");
}

// Stable session reuse (prompt-cache continuity + fingerprint). Map LRU keyed
// per connection/auth, TTL'd like every other session store in the engine.
const stableSessionStore = new Map<string, { sessionId: string; lastUsed: number }>();

function stableSessionKey(credentials: Credentials | null | undefined): string {
  const conn = credentials?.connectionId || (credentials?.id as string | undefined);
  if (conn) return `opencode:conn:${conn}`;
  const auth = (credentials?.apiKey || credentials?.accessToken) as string | undefined;
  if (auth) return `opencode:auth:${crypto.createHash("sha256").update(auth).digest("hex").slice(0, 32)}`;
  return "opencode:default";
}

export function stableOpencodeSessionId(credentials: Credentials | null | undefined = null): string {
  const key = stableSessionKey(credentials);
  const now = Date.now();
  const existing = stableSessionStore.get(key);
  if (existing) {
    if (now - existing.lastUsed <= MEMORY_CONFIG.sessionTtlMs) {
      existing.lastUsed = now;
      // LRU touch: re-insert so the eviction below drops the true oldest.
      stableSessionStore.delete(key);
      stableSessionStore.set(key, existing);
      return existing.sessionId;
    }
    stableSessionStore.delete(key);
  }
  if (stableSessionStore.size >= MAX_STABLE_SESSIONS) {
    const oldest = stableSessionStore.keys().next().value;
    if (oldest !== undefined) stableSessionStore.delete(oldest);
  }
  const sessionId = generateSessionId();
  stableSessionStore.set(key, { sessionId, lastUsed: now });
  return sessionId;
}

interface OpencodeHeaderOpts {
  rawHeaders?: Record<string, unknown> | null;
  credentials?: Credentials | null;
  stream?: boolean;
  url?: string | null;
}

/**
 * The full client fingerprint header set — shared by the executor and the
 * credential probes so the two can never drift.
 */
export function buildOpencodeZenHeaders(opts: OpencodeHeaderOpts = {}): Record<string, string> {
  const raw = (opts.rawHeaders || {}) as Record<string, string>;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

  const downstreamUa = lower["user-agent"] || "";
  const downstreamSession = lower["x-opencode-session"] || "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": "Bearer public",
    "User-Agent": hasValidOpencodeVersion(downstreamUa) ? downstreamUa : OPENCODE_UA,
    "x-opencode-client": lower["x-opencode-client"] || "desktop",
    "x-opencode-session": OPENCODE_SESSION_RE.test(downstreamSession)
      ? downstreamSession
      : stableOpencodeSessionId(opts.credentials),
    "x-opencode-request": generateRequestId(),
    "x-opencode-project": lower["x-opencode-project"] || "global",
    "Accept": opts.stream === false ? "*/*" : "text/event-stream",
  };
  if (opts.url && opts.url.endsWith(ANTHROPIC_MESSAGES_SUFFIX)) {
    headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  }
  return headers;
}

export function buildOpencodeZenProbeRequest(model: string = OPENCODE_ZEN_PROBE_MODEL) {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    stream: true,
  };
  applyFingerprintTools(body, false);
  return {
    url: `${(PROVIDERS.opencode?.baseUrl as string) || ""}${OPENCODE_ZEN_CHAT_PATH}`,
    headers: buildOpencodeZenHeaders({ stream: true }),
    body,
  };
}

/** Tools in the Responses/Claude flat shape ({ name }) instead of chat ({ function }). */
function toolsShapeIsFlat(tools: unknown[]): boolean {
  for (const raw of tools) {
    const tool = raw as Record<string, unknown> | null;
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
    const fn = tool.function as Record<string, unknown> | null | undefined;
    if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") return false;
    if (typeof tool.name === "string" && tool.name.trim()) return true;
  }
  return false;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, _credentials?: Credentials) {
    // Fingerprint runs on a shallow copy (tools array included) so the shared
    // translated body keeps the client's own tool list: `bodyHasTools` and the
    // tools-strip retry must not count the injected quartet as caller tools.
    const target: Record<string, unknown> = { ...body };
    if (Array.isArray(body.tools)) target.tools = [...(body.tools as unknown[])];
    const flat = Array.isArray(target.tools) && (target.tools as unknown[]).length > 0
      ? toolsShapeIsFlat(target.tools as unknown[])
      : MESSAGES_MODELS.has(model);
    const renamed = applyFingerprintTools(target, flat);
    const out = injectReasoningContent({ provider: this.provider, model, body: target });
    // Re-anchor on whatever object flows to the response handlers as
    // `finalBody` — injectReasoningContent is free to clone the body.
    recordRenamedToolNames(out, renamed);
    return out;
  }

  buildUrl(model: string) {
    const base = this.config.baseUrl as string;
    return MESSAGES_MODELS.has(model)
      ? `${base}${OPENCODE_ZEN_MESSAGES_PATH}`
      : `${base}${OPENCODE_ZEN_CHAT_PATH}`;
  }

  buildHeaders(credentials: Credentials, stream = true, url: string | null = null) {
    return buildOpencodeZenHeaders({
      rawHeaders: credentials?.rawHeaders as Record<string, unknown> | undefined,
      credentials,
      stream,
      url,
    });
  }
}

export { generateSessionId, generateRequestId, hasValidOpencodeVersion, OPENCODE_ZEN_PROBE_MODEL };
