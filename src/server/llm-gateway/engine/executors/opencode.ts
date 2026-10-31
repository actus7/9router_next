import crypto from "crypto";
import { BaseExecutor, type ExecuteArgs } from "./base";
import { PROVIDERS } from "../config/providers";
import { MEMORY_CONFIG } from "../config/runtimeConfig";
import { ANTHROPIC_API_VERSION } from "../providers/shared";
import { getThinkingLevels } from "../providers/thinkingLevels";
import { injectReasoningContent } from "../utils/reasoningContentInjector";
import { applyFingerprintTools, recordRenamedToolNames } from "../utils/opencodeFingerprint";
import { opencodeTlsFetch } from "../services/opencodeTlsClient";
import { normalizeResponsesInput } from "../translator/formats/responsesApi";
import type { Credentials } from "../services/types";

/**
 * OpenCode Free (opencode.ai) — the v2 CLI contract, ported from
 * decolua/9router v0.5.111. The free tier passes only when all three gates
 * match the official CLI:
 *
 * - transport: TLS ClientHello (services/opencodeTlsClient);
 * - body: OpenCode's `read`/`shell` tools plus the `<env>` system marker
 *   (utils/opencodeFingerprint);
 * - headers: the v2 UA shape and session headers, no `x-opencode-request`.
 *
 * Since 2026-10-14 the v1 shape (UA `opencode/1.18.x`, `/zen/v1`) answers
 * 403 FreeTierError / 429 FreeUsageLimitError.
 */

/** v2 UA shape: opencode/<channel>/<version>/<client>. */
const OPENCODE_UA = "opencode/latest/2.0.26/cli";
const OPENCODE_CLIENT = "cli";
const INFERENCE_PATH = "/inference/v1";
const ANTHROPIC_MESSAGES_SUFFIX = "/messages";

/** Models served by /inference/v1/responses; every other model is chat. */
const RESPONSES_MODELS = new Set(["muse-spark-1.2-contributor-free", "muse-spark-1.3-contributor-free"]);
const MESSAGES_MODELS = new Set(["union-alpha"]);
// ponytail: the only model confirmed to reject a non-auto tool_choice; widen on evidence.
const FORCE_AUTO_TOOL_CHOICE_MODELS = new Set(["muse-spark-1.3-contributor-free"]);

/** Canonical id shape the gate accepts: 12 lowercase hex + 14 base62 chars. */
export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RANDOM_LEN = 14;
const SESSION_PREFIX_MASK = (1n << 48n) - 1n;
const MAX_STABLE_SESSIONS = 1000;

/** Probe model for the free catalogue (observed upstream id). */
export const OPENCODE_ZEN_PROBE_MODEL = "big-pickle";

export function hasValidOpencodeVersion(ua: unknown): boolean {
  const m = String(ua || "").match(/^opencode\/[a-z0-9-]+\/(\d+)\.\d+\.\d+\/[a-z0-9-]+$/i);
  return !!m && parseInt(m[1], 10) >= 2;
}

function unstableRandom(): string {
  const bytes = crypto.randomBytes(RANDOM_LEN);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) out += BASE62[bytes[i] % BASE62.length];
  return out;
}

let lastTimestamp = 0;
let counter = 0;

/**
 * Canonical `ses_` id. Upstream decodes the time prefix: it must be the
 * current time (a digest-derived time passed 1/10) and the counter must stay
 * small (>= 100 answers 403), which is what a real per-ms counter gives.
 */
export function generateSessionId(timestamp = Date.now()): string {
  if (timestamp !== lastTimestamp) { lastTimestamp = timestamp; counter = 0; }
  counter++;
  const prefix = (~(BigInt(timestamp) * 0x1000n + BigInt(counter)) & SESSION_PREFIX_MASK).toString(16).padStart(12, "0");
  return `ses_${prefix}${unstableRandom()}`;
}

// Free quota is accounted per session: minting one per request burns it and
// surfaces as 429 with a growing reset delay. The CLI reuses one session per
// conversation, so keep one per connection/auth identity, TTL'd like every
// other session store in the engine.
const stableSessionStore = new Map<string, { sessionId: string; lastUsed: number }>();

function stableSessionKey(credentials: Credentials | null | undefined): string {
  const conn = credentials?.connectionId || (credentials?.id as string | undefined);
  if (conn) return `opencode:conn:${String(conn).slice(0, 128)}`;
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

/** The v2 CLI header set — shared by the executor and the credential probes so they never drift. */
export function buildOpencodeZenHeaders(opts: OpencodeHeaderOpts = {}): Record<string, string> {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.rawHeaders || {})) if (typeof v === "string") lower[k.toLowerCase()] = v;

  const downstreamUa = lower["user-agent"] || "";
  const downstreamSession = (lower["x-opencode-session"] || "").trim();
  const session = OPENCODE_SESSION_RE.test(downstreamSession) ? downstreamSession : stableOpencodeSessionId(opts.credentials);

  // Upstream needs x-opencode-session-id beside x-opencode-session and refuses
  // the v1-only x-opencode-request with 403.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": "Bearer public",
    "User-Agent": hasValidOpencodeVersion(downstreamUa) ? downstreamUa : OPENCODE_UA,
    "x-opencode-client": lower["x-opencode-client"] || OPENCODE_CLIENT,
    "x-opencode-session": session,
    "x-opencode-session-id": session,
    "x-session-affinity": session,
    "x-session-id": session,
    "x-opencode-project": lower["x-opencode-project"] || "global",
    "Accept": opts.stream === false ? "*/*" : "text/event-stream",
  };
  if (opts.url?.endsWith(ANTHROPIC_MESSAGES_SUFFIX)) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  return headers;
}

function baseUrl(): string {
  return (PROVIDERS.opencode?.baseUrl as string) || "https://opencode.ai";
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
    url: `${baseUrl()}${INFERENCE_PATH}/chat/completions`,
    headers: buildOpencodeZenHeaders({ stream: true }),
    body,
  };
}

/** Strip the thinking suffix "model(level)" so set lookups hit the base id. */
function baseModelId(model: unknown): string {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

const isResponsesModel = (model: unknown) => RESPONSES_MODELS.has(baseModelId(model));
const isMessagesModel = (model: unknown) => MESSAGES_MODELS.has(baseModelId(model));

/** Responses API names the cap max_output_tokens and thinking reasoning:{effort,summary}. */
function normalizeResponsesBody(model: string, body: Record<string, unknown>): void {
  if (body.tool_choice !== undefined && body.tool_choice !== "auto" && FORCE_AUTO_TOOL_CHOICE_MODELS.has(baseModelId(model))) {
    body.tool_choice = "auto";
  }
  body.input = normalizeResponsesInput(body.input as string | Record<string, unknown>[]) ?? body.input;
  if (body.max_output_tokens === undefined) body.max_output_tokens = body.max_completion_tokens ?? body.max_tokens;
  if (body.max_output_tokens === undefined) delete body.max_output_tokens;
  delete body.max_tokens;
  delete body.max_completion_tokens;

  const current = body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning)
    ? body.reasoning as Record<string, unknown>
    : null;
  const requested = typeof body.reasoning_effort === "string" ? body.reasoning_effort : current?.effort;
  if (typeof requested === "string") {
    const supported = getThinkingLevels("opencode", baseModelId(model));
    let effort = requested.toLowerCase().trim();
    if ((effort === "max" || effort === "ultra") && supported?.length && !supported.includes(effort)) {
      if (effort === "ultra" && supported.includes("max")) effort = "max";
      else if (supported.includes("xhigh")) effort = "xhigh";
    }
    body.reasoning = { ...current, effort, summary: current?.summary || "auto" };
    delete body.reasoning_effort;
  }
  // Pooled `Bearer public` credentials: a prior turn's encrypted reasoning was
  // issued to another account and is refused, so drop reasoning items.
  if (Array.isArray(body.input)) {
    body.input = (body.input as unknown[]).filter((item) => !(item && typeof item === "object" && (item as Record<string, unknown>).type === "reasoning"));
  }
  body.store = false;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, _credentials?: Credentials) {
    // Fingerprint a shallow copy (tools array included) so the shared
    // translated body keeps the caller's own tool list: `bodyHasTools` and the
    // tools-strip retry must not count the injected tools as the caller's.
    const target: Record<string, unknown> = { ...body };
    if (Array.isArray(body.tools)) target.tools = [...(body.tools as unknown[])];
    if (!target.model) target.model = model;
    // Free models refuse non-streaming requests; the handlers aggregate for JSON clients.
    target.stream = true;

    const responses = isResponsesModel(model);
    if (responses) normalizeResponsesBody(model, target);
    // Chat lane validates reasoning_effort against the OpenAI enum; adaptive
    // thinking arrives as "auto", which it answers 400 — omit and let it default.
    else if (target.reasoning_effort === "auto") delete target.reasoning_effort;

    const renamed = applyFingerprintTools(target, responses, { claude: isMessagesModel(model) });
    const out = injectReasoningContent({ provider: this.provider, model, body: target });
    // Re-anchor on whatever object reaches the response handlers as `finalBody`.
    recordRenamedToolNames(out, renamed);
    return out;
  }

  // The free gate keys on the TLS ClientHello, so the direct leg goes through
  // the impersonating client. A configured proxy still wins (and is refused).
  async execute(args: ExecuteArgs) {
    return super.execute({ ...args, directFetch: opencodeTlsFetch });
  }

  buildUrl(model: string) {
    const base = `${this.config.baseUrl as string}${INFERENCE_PATH}`;
    if (isResponsesModel(model)) return `${base}/responses`;
    if (isMessagesModel(model)) return `${base}/messages`;
    return `${base}/chat/completions`;
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
