import crypto from "node:crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager";
import { normalizeResponsesInput } from "../translator/formats/responsesApi";
import { getModelUpstreamId } from "../config/providerModels";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_VERSION,
  supportsGrokCliReasoningEffort,
} from "../config/grokCli";
import { MEMORY_CONFIG } from "../config/runtimeConfig";
import { resolveSessionId } from "../utils/sessionManager";
import { getConsistentMachineId } from "../shared/machineId";
import type { Credentials, Logger, RefreshResult } from "../services/types";
import type { ExecuteArgs } from "./base";

// Server-generated item id prefixes that /responses cannot resolve when store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

// Hosted tool types executed server-side by Grok CLI backend
const HOSTED_TOOL_TYPES = new Set([
  "web_search",
  "x_search",
  "web_search_preview",
  "file_search",
  "image_generation",
  "code_interpreter",
  "mcp",
  "local_shell",
]);

// Fields accepted by cli-chat-proxy Responses API (mirrors Codex allowlist + Grok extras)
const RESPONSES_API_ALLOWLIST = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "stream",
  "store",
  "reasoning",
  "include",
  "temperature",
  "top_p",
  "max_output_tokens",
  "parallel_tool_calls",
  "text",
  "metadata",
  "prompt_cache_key",
]);

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"];
const GROK_CLI_TURN_STORE_MAX = 5000;
const GROK_CLI_NATIVE_ITEM_ID = /^(?:rs|msg|fc)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROK_CLI_FREEFORM_TOOL_PARAMETERS = {
  type: "object",
  properties: { input: { type: "string" } },
  required: ["input"],
};

// Per-session last turn index so multi-turn headers never go backwards within this process
const sessionTurnStore = new Map();
let requestTurnStore = new WeakMap();

/**
 * Count user turns in a Responses `input` array.
 * Official CLI sets x-grok-turn-idx to the 1-based conversation turn (≈ user messages).
 * HAR: first chat turn → "1".
 */
function countGrokCliUserTurns(input: unknown): number {
  if (!Array.isArray(input)) return 1;
  let n = 0;
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const type = typeof rec.type === "string" ? rec.type : "";
    // Responses message items (type omitted or "message") with role user
    if (rec.role === "user" && (!type || type === "message")) n += 1;
  }
  return Math.max(1, n);
}

/**
 * Resolve monotonic turn index for a session.
 * Prefers user-message count from the payload (full history clients), but never
 * decreases vs the last index observed for the same sessionId in this process.
 */
function resolveGrokCliTurnIdx(sessionId: string, input: unknown, requestKey: unknown = null): number {
  const fromInput = countGrokCliUserTurns(input);
  if (!sessionId) return fromInput;

  if (requestKey && requestTurnStore.has(requestKey)) {
    return requestTurnStore.get(requestKey);
  }

  const now = Date.now();
  const existing = sessionTurnStore.get(sessionId);
  const prev = existing && now - existing.lastUsed <= MEMORY_CONFIG.sessionTtlMs
    ? existing.turn
    : 0;
  if (existing) sessionTurnStore.delete(sessionId);

  // A new delta-style request advances the turn; retries reuse requestKey.
  const turn = prev > 0 ? Math.max(fromInput, prev + (requestKey ? 1 : 0)) : fromInput;
  while (sessionTurnStore.size >= GROK_CLI_TURN_STORE_MAX) {
    sessionTurnStore.delete(sessionTurnStore.keys().next().value);
  }
  sessionTurnStore.set(sessionId, { turn, lastUsed: now });
  if (requestKey) requestTurnStore.set(requestKey, turn);
  return turn;
}

/** Test helper — clear in-memory turn counters */
function _resetGrokCliTurnStore() {
  sessionTurnStore.clear();
  requestTurnStore = new WeakMap();
}

function _getGrokCliTurnStoreSize() {
  return sessionTurnStore.size;
}

function normalizeGrokCliEffort(value: unknown): string {
  const effort = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (effort === "max") return "xhigh";
  if (EFFORT_LEVELS.includes(effort)) return effort;
  return "high";
}


function resolveGrokCliSessionId(credentials: Credentials, body: Record<string, unknown>): string {
  // ponytail: clients without stable thread metadata share one connection session;
  // split further when their wire format exposes a durable conversation id.
  const explicitSessionBody = {
    prompt_cache_key: body?.prompt_cache_key,
    session_id: body?.session_id,
    conversation_id: body?.conversation_id,
    metadata: body?.metadata,
  };
  return resolveSessionId({
    headers: credentials?.rawHeaders as Record<string, string> | undefined,
    body: explicitSessionBody,
    connectionId: credentials?.connectionId || credentials?.id,
    workspaceId: credentials?.providerSpecificData?.workspaceId as string | undefined,
    scope: "grok-cli",
  });
}

function stringifyGrokCliToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  return JSON.stringify(output);
}

function isNativeGrokCliItemId(id: unknown): boolean {
  return typeof id === "string" && GROK_CLI_NATIVE_ITEM_ID.test(id);
}

function normalizeGrokCliInputItem(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const rec = item as Record<string, unknown>;
  const { internal_chat_message_metadata_passthrough: _metadata, ...clean } = rec;

  if (rec.type === "reasoning") {
    if (!isNativeGrokCliItemId(rec.id) || typeof rec.encrypted_content !== "string") return null;
    return clean;
  }

  if (rec.type === "custom_tool_call") {
    const callId = rec.call_id || rec.id;
    const name = typeof rec.name === "string" ? (rec.name as string).trim() : "";
    if (!callId || !name) return null;
    return {
      type: "function_call",
      call_id: callId,
      name,
      arguments: JSON.stringify({ input: stringifyGrokCliToolOutput(rec.input ?? rec.arguments) }),
    };
  }

  if (rec.type === "custom_tool_call_output" || rec.type === "function_call_output") {
    const callId = rec.call_id || rec.id;
    if (!callId) return null;
    return {
      type: "function_call_output",
      call_id: callId,
      output: stringifyGrokCliToolOutput(rec.output),
    };
  }

  if (rec.type === "function_call") {
    const callId = rec.call_id || rec.id;
    const name = typeof rec.name === "string" ? (rec.name as string).trim() : "";
    if (!callId || !name) return null;
    return {
      type: "function_call",
      ...(isNativeGrokCliItemId(rec.id) ? { id: rec.id } : {}),
      call_id: callId,
      name,
      arguments: typeof rec.arguments === "string" ? rec.arguments : JSON.stringify(rec.arguments ?? {}),
      ...(typeof rec.status === "string" ? { status: rec.status } : {}),
    };
  }

  return clean;
}

function normalizeGrokCliInput(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body?.input)) return body;
  const inputArr = body.input as unknown[];
  const normalized: unknown[] = inputArr.map(normalizeGrokCliInputItem).filter(Boolean);
  const callIds = new Set(
    normalized
      .filter((item: unknown) => (item as Record<string, unknown>)?.type === "function_call" && (item as Record<string, unknown>).call_id)
      .map((item: unknown) => (item as Record<string, unknown>).call_id)
  );
  body.input = normalized.filter(
    (item: unknown) => (item as Record<string, unknown>)?.type !== "function_call_output" || callIds.has((item as Record<string, unknown>).call_id)
  );
  return body;
}

function stripStoredItemReferences(body: Record<string, unknown>): void {
  if (!Array.isArray(body.input)) return;
  const inputArr = body.input as unknown[];
  body.input = inputArr.filter((item: unknown) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (rec.type === "item_reference") return false;
      if (
        typeof rec.id === "string" &&
        SERVER_ID_PATTERN.test(rec.id) &&
        !isNativeGrokCliItemId(rec.id)
      ) delete rec.id;
    }
    return true;
  });
}

/**
 * Flatten Chat Completions tool shape → Responses flat format.
 * Keep hosted tools (web_search / x_search) passthrough.
 */
function normalizeGrokCliTools(body: Record<string, unknown>): void {
  if (!Array.isArray(body.tools) || (body.tools as unknown[]).length === 0) {
    delete body.tools;
    delete body.tool_choice;
    return;
  }
  const validNames = new Set<string>();
  const hostedTypes = new Set<string>();
  const toolsArr = body.tools as unknown[];
  body.tools = toolsArr.filter((tool: unknown) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const t = tool as Record<string, unknown>;
    const type = typeof t.type === "string" ? t.type : "";

    if (type !== "function") {
      // Hosted tools: { type: "web_search" } / { type: "x_search" }
      if (HOSTED_TOOL_TYPES.has(type)) {
        hostedTypes.add(type);
        return true;
      }
      // Nested function shape without type
      if (!type && t.function) {
        // fall through to function flatten below
      } else if (!type || typeof t.name === "string") {
        // treat as bare function if name present
      } else {
        return false;
      }
    }

    const isFunction =
      type === "function" || type === "" || t.function || typeof t.name === "string";
    if (!isFunction || HOSTED_TOOL_TYPES.has(type)) {
      return HOSTED_TOOL_TYPES.has(type);
    }

    const fn =
      t.function && typeof t.function === "object" && !Array.isArray(t.function)
        ? t.function as Record<string, unknown>
        : null;
    const rawName =
      typeof t.name === "string" ? t.name : typeof fn?.name === "string" ? fn.name : "";
    const name = rawName.trim();
    if (!name) return false;

    const description =
      typeof t.description === "string"
        ? t.description
        : typeof fn?.description === "string"
          ? fn.description
          : "";
    const parameters = type === "custom"
      ? GROK_CLI_FREEFORM_TOOL_PARAMETERS
      : t.parameters && typeof t.parameters === "object" && !Array.isArray(t.parameters)
        ? t.parameters
        : fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
          ? fn.parameters
          : { type: "object", properties: {} };

    for (const k of Object.keys(t)) delete t[k];
    t.type = "function";
    t.name = name.slice(0, 128);
    if (description) t.description = description;
    t.parameters = parameters;
    validNames.add(name);
    return true;
  });

  if ((body.tools as unknown[]).length === 0) {
    delete body.tools;
    delete body.tool_choice;
    return;
  }

  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    const tc = body.tool_choice as Record<string, unknown>;
    const choiceType = typeof tc.type === "string" ? tc.type : "";
    if (choiceType === "function" || choiceType === "custom") {
      const rawName = tc.name ?? (tc.function as Record<string, unknown> | undefined)?.name;
      const name = typeof rawName === "string" ? rawName.trim().slice(0, 128) : "";
      if (!name || !validNames.has(name)) delete body.tool_choice;
      else body.tool_choice = { type: "function", name };
    } else if (!hostedTypes.has(choiceType)) {
      delete body.tool_choice;
    }
  }
}

function resolveEffortFromModel(modelId: unknown): string | null {
  if (!modelId || typeof modelId !== "string") return null;
  for (const level of EFFORT_LEVELS) {
    if (modelId.endsWith(`-${level}`)) return level;
  }
  return null;
}

/**
 * Grok CLI Executor — OpenAI Responses API on cli-chat-proxy.grok.com
 * Auth: OAuth device-code access token (xai-grok-cli).
 */
export class GrokCliExecutor extends BaseExecutor {
  _currentSessionId: string | null = null;
  _currentReqId: string | null = null;
  _currentTurnIdx: number = 1;
  _agentId: string | null = null;
  _currentModel: string | null = null;

  constructor() {
    super("grok-cli", PROVIDERS["grok-cli"]);
  }

  buildUrl(_model?: string, _stream?: boolean, _urlIndex?: number, _credentials?: Credentials | null): string {
    return this.config.baseUrl as string;
  }

  async refreshCredentials(credentials: Credentials, log?: Logger, _proxyOptions: unknown = null): Promise<RefreshResult | null> {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("grok-cli", credentials, log);
  }

  needsRefresh(credentials: Credentials): boolean {
    return shouldRefreshCredentials("grok-cli", credentials);
  }

  buildHeaders(credentials: Credentials, stream = true): Record<string, string> {
    const headers = super.buildHeaders(credentials, stream);

    // Static fingerprint from registry
    const staticHeaders = this.config.headers || {};
    for (const [k, v] of Object.entries(staticHeaders)) {
      if (v != null && headers[k] === undefined) headers[k] = v as string;
    }

    headers["x-grok-client-identifier"] =
      (this.config.clientIdentifier as string) || headers["x-grok-client-identifier"] || GROK_CLI_CLIENT_IDENTIFIER;
    headers["x-grok-client-version"] =
      (this.config.clientVersion as string) || headers["x-grok-client-version"] || GROK_CLI_VERSION;

    const sessionId = this._currentSessionId || credentials?.connectionId || crypto.randomUUID();
    const reqId = this._currentReqId || crypto.randomUUID();
    headers["x-grok-session-id"] = sessionId;
    // CLI uses the same id for conv + session on chat turns
    headers["x-grok-conv-id"] = sessionId;
    headers["x-grok-req-id"] = reqId;
    headers["x-grok-turn-idx"] = String(this._currentTurnIdx || 1);

    if (this._agentId) headers["x-grok-agent-id"] = this._agentId;

    // Surface model override (CLI always sets this)
    if (this._currentModel) headers["x-grok-model-override"] = this._currentModel;

    // Identity: mapTokens stores email top-level AND in providerSpecificData;
    // fall back either way so OAuth connections always fingerprint like the CLI.
    const psd = credentials?.providerSpecificData || {};
    const email = psd.email || credentials?.email;
    const userId = psd.userId || credentials?.userId || credentials?.providerUserId;
    if (email) headers["x-email"] = email as string;
    if (userId) headers["x-userid"] = userId as string;

    return headers;
  }

  parseError(response: Response, bodyText: string): { status: number; message: string; code?: string } {
    // 402 personal-team-blocked:spending-limit → surface as payment/quota for fallback
    if (response.status === 402 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const code = json?.code || "";
        const msg = json?.error || json?.message || bodyText;
        return {
          status: 402,
          message: typeof msg === "string" ? msg : bodyText,
          code: typeof code === "string" ? code : undefined,
        };
      } catch {
        /* fall through */
      }
    }
    return super.parseError(response, bodyText);
  }

  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Credentials): Record<string, unknown> {
    // Session / request ids for headers — stable per client conversation when possible
    const requestKey = body;
    this._currentSessionId = resolveGrokCliSessionId(credentials, body);
    this._currentReqId = crypto.randomUUID();
    this._agentId =
      (credentials?.providerSpecificData?.deviceId as string) ||
      (credentials?.providerSpecificData?.agentId as string) ||
      null;

    // Normalize Responses input
    const normalized = normalizeResponsesInput(body.input as string | Record<string, unknown>[]);
    if (normalized) body.input = normalized;

    // Chat Completions clients arrive with messages[] — translator should have
    // converted already, but guard empty input.
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      if (Array.isArray(body.messages) && body.messages.length > 0) {
        // Soft fallback: map messages → input messages (string content only)
        body.input = (body.messages as Record<string, unknown>[]).map((m: Record<string, unknown>) => ({
          type: "message",
          role: m.role || "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
        }));
        delete body.messages;
      } else {
        body.input = [{ type: "message", role: "user", content: "..." }];
      }
    }

    // Keep role:"system" as-is — official grok-pager HAR sends system, not developer
    // (Codex converts system→developer; Grok CLI does not).
    normalizeGrokCliInput(body);
    stripStoredItemReferences(body);
    normalizeGrokCliTools(body);

    // Turn index after input is finalized (user-message count, monotonic per session)
    this._currentTurnIdx = resolveGrokCliTurnIdx(this._currentSessionId!, body.input, requestKey);

    body.stream = true;
    body.store = false;

    // Resolve upstream model id (strip effort suffix virtual models)
    const modelEffort = resolveEffortFromModel(body.model || model);
    let resolvedModel = (body.model || model) as string;
    if (modelEffort) {
      resolvedModel = resolvedModel.replace(new RegExp(`-${modelEffort}$`), "");
    }
    resolvedModel = getModelUpstreamId("gcli", resolvedModel) || resolvedModel;
    // Also try provider id key
    if (resolvedModel === (body.model || model)) {
      resolvedModel = getModelUpstreamId("grok-cli", resolvedModel) || resolvedModel;
    }
    body.model = resolvedModel;
    this._currentModel = resolvedModel;

    // Reasoning effort priority: explicit > reasoning_effort > model suffix > default high.
    // grok-build and Composer reject reasoningEffort but still accept summary/encrypted continuity.
    const supportsReasoningEffort = supportsGrokCliReasoningEffort(resolvedModel);
    if (!body.reasoning || typeof body.reasoning !== "object") {
      body.reasoning = { summary: "concise" };
      if (supportsReasoningEffort) {
        (body.reasoning as Record<string, unknown>).effort = normalizeGrokCliEffort(body.reasoning_effort || modelEffort);
      }
    } else {
      if (supportsReasoningEffort) {
        (body.reasoning as Record<string, unknown>).effort = normalizeGrokCliEffort(
          (body.reasoning as Record<string, unknown>).effort || body.reasoning_effort || modelEffort,
        );
      } else {
        delete (body.reasoning as Record<string, unknown>).effort;
      }
      if (!(body.reasoning as Record<string, unknown>).summary) (body.reasoning as Record<string, unknown>).summary = "concise";
    }
    delete body.reasoning_effort;

    // Encrypted reasoning for multi-turn continuity (CLI always requests this)
    if (body.reasoning && (body.reasoning as Record<string, unknown>).effort !== "none") {
      const include = Array.isArray(body.include) ? body.include : [];
      if (!include.includes("reasoning.encrypted_content")) {
        include.push("reasoning.encrypted_content");
      }
      body.include = include;
    }

    // Drop Chat Completions leftovers that Responses rejects
    delete body.messages;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.n;
    delete body.seed;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logit_bias;
    delete body.user;
    delete body.stream_options;
    delete body.prompt_cache_retention;
    delete body.safety_identifier;
    delete body.previous_response_id; // store=false → cannot resolve

    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    return body;
  }

  async execute(args: ExecuteArgs) {
    // Lazy-resolve stable agent id once per process if connection has none
    if (!this._agentId && !args.credentials?.providerSpecificData?.deviceId) {
      try {
        const mid = await getConsistentMachineId("grok-cli-agent");
        // Format as UUID-ish for header aesthetics
        this._agentId = [
          mid.slice(0, 8),
          mid.slice(8, 12),
          "5" + mid.slice(13, 16),
          "a" + mid.slice(17, 20),
          mid.slice(0, 12).padEnd(12, "0"),
        ].join("-");
      } catch {
        this._agentId = crypto.randomUUID();
      }
    } else if (args.credentials?.providerSpecificData?.deviceId) {
      this._agentId = args.credentials.providerSpecificData.deviceId as string;
    }

    return super.execute(args);
  }
}

export default GrokCliExecutor;
