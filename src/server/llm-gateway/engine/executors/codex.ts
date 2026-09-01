import { BaseExecutor } from "./base";
import type { ExecuteArgs } from "./base";
import type { Credentials, Logger, RefreshResult } from "../services/types";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions";
import { PROVIDERS } from "../config/providers";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager";
import { normalizeResponsesInput } from "../translator/formats/responsesApi";
import { fetchImageAsBase64 } from "../translator/concerns/image";
import { getModelUpstreamId } from "../config/providerModels";
import { getThinkingLevels } from "../providers/thinkingLevels";
import { DEFAULT_RETRY_CONFIG, HTTP_STATUS, resolveRetryEntry } from "../config/runtimeConfig";
import { dbg } from "../utils/debugLog";
import { resolveSessionId } from "../utils/sessionManager";

// SSE error patterns inside 200-OK bodies. Some retry same account first; capacity rotates accounts.
const CODEX_SSE_RETRY_PATTERNS = ["server_is_overloaded", "service_unavailable_error"];
const CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS = ["selected model is at capacity", "model_at_capacity"];
const CODEX_SSE_USER_OUTPUT_PATTERNS = [
  "event: response.output_text.delta",
  "event: response.function_call_arguments.delta",
  '"type":"response.output_text.delta"',
  '"type":"response.function_call_arguments.delta"',
];
const CODEX_SSE_PEEK_BYTES = 256 * 1024;
const CODEX_MODEL_CAPACITY_MESSAGE = "Selected model is at capacity. Please try a different model.";

// Server-generated item id prefixes that Codex /responses cannot resolve when store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

// Hosted tool types that Codex/OpenAI Responses executes server-side
const CODEX_HOSTED_TOOL_TYPES = new Set([
  "image_generation", "web_search", "web_search_preview", "file_search",
  "computer", "computer_use_preview", "code_interpreter", "mcp", "local_shell",
  "tool_search"
]);

// Responses-native freeform tools carry a name plus format payload and must pass through intact.
const CODEX_PASSTHROUGH_TOOL_TYPES = new Set(["custom"]);

// Allowlist of fields accepted by Codex Responses API — anything else is stripped
const RESPONSES_API_ALLOWLIST = new Set([
  "model", "input", "instructions", "tools", "tool_choice", "stream", "store",
  "reasoning", "service_tier", "include", "prompt_cache_key", "client_metadata",
  "text"
]);

// Convert role=system → role=developer in body.input (keeps content in cacheable prefix)
function convertSystemToDeveloperRole(body: Record<string, unknown>) {
  if (!Array.isArray(body.input)) return;
  for (const item of body.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const isSystemMsg = rec.role === "system" && (!rec.type || rec.type === "message");
    if (isSystemMsg) rec.role = "developer";
  }
}

// Strip server-generated item IDs (rs_/fc_/resp_/msg_) from input — avoids 404 with store=false
function stripStoredItemReferences(body: Record<string, unknown>) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item: unknown) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (rec.type === "item_reference") return false;
      if (typeof rec.id === "string" && SERVER_ID_PATTERN.test(rec.id)) delete rec.id;
    }
    return true;
  });
}

// Flatten Chat-Completions tool shape into Responses flat format + filter unsupported tools
function normalizeCodexTools(body: Record<string, unknown>) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set<string>();
  body.tools = body.tools.filter((tool: unknown) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const t = tool as Record<string, unknown>;
    const type = typeof t.type === "string" ? t.type : "";
    if (type === "namespace") {
      if (Array.isArray(t.tools)) {
        for (const st of t.tools) {
          const stRec = st as Record<string, unknown> | null;
          const n = typeof stRec?.name === "string" ? (stRec.name as string).trim().slice(0, 128) : "";
          if (n) validNames.add(n);
        }
      }
      return true;
    }
    if (type !== "function") {
      if (CODEX_PASSTHROUGH_TOOL_TYPES.has(type)) return true;
      if (!type || t.function || typeof t.name === "string") return false;
      return CODEX_HOSTED_TOOL_TYPES.has(type);
    }
    const fn = t.function && typeof t.function === "object" && !Array.isArray(t.function) ? t.function as Record<string, unknown> : null;
    const rawName = typeof t.name === "string" ? t.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof t.description === "string" ? t.description : (typeof fn?.description === "string" ? fn.description : "");
    const parameters = (t.parameters && typeof t.parameters === "object" && !Array.isArray(t.parameters))
      ? t.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    for (const k of Object.keys(t)) delete t[k];
    t.type = "function";
    t.name = name.slice(0, 128);
    if (description) t.description = description;
    t.parameters = parameters;
    validNames.add(name);
    return true;
  });
  // Drop tool_choice if it references an unknown function name
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    const tc = body.tool_choice as Record<string, unknown>;
    if (tc.type === "function") {
      const n = typeof tc.name === "string" ? (tc.name as string).trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Resolve prompt-cache session id: client session → assistant-text-hash → workspaceId → connection
function resolveCacheSessionId(body: Record<string, unknown>, credentials: Credentials) {
  return resolveSessionId({
    headers: credentials?.rawHeaders as Record<string, string> | undefined,
    body,
    connectionId: credentials?.connectionId,
    workspaceId: credentials?.providerSpecificData?.workspaceId as string | undefined,
    scope: "codex"
  });
}

function normalizeReasoningEffort(model: string, value: string) {
  const supportedLevels = getThinkingLevels("codex", model);
  if (supportedLevels?.includes(value)) return value;
  if (value === "ultra" && supportedLevels?.includes("max")) return "max";
  if (value === "max" || value === "ultra") return "xhigh";
  return value;
}

function findNestedMessage(value: unknown, depth = 0): string | null {
  if (!value || depth > 6 || typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found: string | null = findNestedMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.message === "string" && (obj.message as string).trim()) return obj.message as string;
  const err = obj.error as Record<string, unknown> | undefined;
  if (typeof err?.message === "string" && (err.message as string).trim()) return err.message as string;
  const resp = obj.response as Record<string, unknown> | undefined;
  const respErr = resp?.error as Record<string, unknown> | undefined;
  if (typeof respErr?.message === "string" && (respErr.message as string).trim()) return respErr.message as string;
  for (const child of Object.values(obj)) {
    const found: string | null = findNestedMessage(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractSseErrorMessage(text: string, fallback: string) {
  const exact = text?.match(/Selected model is at capacity\. Please try a different model\./i)?.[0];
  if (exact) return exact;

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const message = findNestedMessage(JSON.parse(data));
      if (message) return message;
    } catch {
      // Ignore non-JSON SSE data lines.
    }
  }

  return fallback || CODEX_MODEL_CAPACITY_MESSAGE;
}

function codexSseErrorResponse(status: number, message: string) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: status === HTTP_STATUS.SERVICE_UNAVAILABLE ? "service_unavailable" : "upstream_error",
    }
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeCodexInput(body: Record<string, unknown>): void {
  const normalized = normalizeResponsesInput(body.input as string | Record<string, unknown>[]);
  if (normalized) body.input = normalized;
  if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
    body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
  }
  convertSystemToDeveloperRole(body);
  stripStoredItemReferences(body);
  normalizeCodexTools(body);
}

function configureCodexReasoning(body: Record<string, unknown>, model: string): void {
  body.model = getModelUpstreamId("cx", (body.model as string) || model);

  const effortLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  let modelEffort = null;
  for (const level of effortLevels) {
    if ((body.model as string).endsWith(`-${level}`)) {
      modelEffort = level;
      body.model = (body.model as string).replace(`-${level}`, '');
      break;
    }
  }

  if (!body.reasoning) {
    const effort = normalizeReasoningEffort(body.model as string, (body.reasoning_effort as string) || modelEffort || 'low');
    body.reasoning = { effort, summary: "auto" };
  } else {
    const reasoning = body.reasoning as Record<string, unknown>;
    reasoning.effort = normalizeReasoningEffort(body.model as string, reasoning.effort as string);
    if (!reasoning.summary) reasoning.summary = "auto";
  }
  delete body.reasoning_effort;

  if (body.reasoning && (body.reasoning as Record<string, unknown>).effort && (body.reasoning as Record<string, unknown>).effort !== 'none') {
    body.include = ["reasoning.encrypted_content"];
  }
}

function stripUnsupportedCodexParams(body: Record<string, unknown>): void {
  const unsupported = [
    'temperature', 'top_p', 'frequency_penalty', 'presence_penalty',
    'logprobs', 'top_logprobs', 'n', 'seed', 'max_tokens',
    'max_completion_tokens', 'max_output_tokens', 'user',
    'prompt_cache_retention', 'metadata', 'stream_options',
    'safety_identifier', 'previous_response_id',
  ];
  for (const key of unsupported) delete body[key];

  if (body.service_tier === "fast") body.service_tier = "priority";
  if (body.service_tier && body.service_tier !== "priority") delete body.service_tier;

  for (const k of Object.keys(body)) {
    if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
  }
}

/**
 * Codex Executor - handles OpenAI Codex API (Responses API format)
 * Automatically injects default instructions if missing
 */
export class CodexExecutor extends BaseExecutor {
  protected _currentSessionId!: string | null;
  protected _isCompact!: boolean;

  constructor() {
    super("codex", PROVIDERS.codex);
    this._currentSessionId = null;
  }

  /**
   * Override headers to add codex-specific identity headers.
   * transformRequest runs BEFORE buildHeaders, sets this._currentSessionId.
   */
  buildHeaders(credentials: Credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);
    headers["session_id"] = this._currentSessionId || credentials?.connectionId || "default";
    // Identify client type to Codex backend (matches official codex CLI)
    if (!headers["originator"]) headers["originator"] = "codex_cli_rs";
    // Account/workspace binding header — required when multiple Codex accounts
    // are configured. OAuth import stores ChatGPT account ID as chatgptAccountId;
    // older/custom rows may use workspaceId/accountId. Prefer explicit workspaceId
    // but fall back to chatgptAccountId so requests don't cross-bind to the wrong
    // OpenAI account and surface as token_invalid after adding another account.
    const accountId =
      credentials?.providerSpecificData?.workspaceId ||
      credentials?.providerSpecificData?.chatgptAccountId ||
      credentials?.providerSpecificData?.accountId;
    if (typeof accountId === "string" && accountId && !headers["ChatGPT-Account-ID"]) {
      headers["ChatGPT-Account-ID"] = accountId;
    }
    return headers;
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials: Credentials | null = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return this._isCompact ? `${base}/compact` : base;
  }

  async refreshCredentials(credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("codex", credentials, log);
  }

  needsRefresh(credentials: Credentials) {
    return shouldRefreshCredentials("codex", credentials);
  }

  /**
   * Prefetch remote image URLs and inline them as base64 data URIs.
   * Runs before execute() because Codex backend cannot fetch remote images.
   * Mutates body.input in place.
   */
  async prefetchImages(body: Record<string, unknown>) {
    if (!Array.isArray(body?.input)) return;
    for (const item of body.input as Record<string, unknown>[]) {
      if (!Array.isArray(item.content)) continue;
      const pending = (item.content as Record<string, unknown>[]).map(async (c: Record<string, unknown>) => {
        if (c.type !== "image_url") return c;
        const imageUrl = c.image_url;
        const url: string = typeof imageUrl === "string" ? imageUrl : String((imageUrl as Record<string, unknown>)?.url ?? "");
        const detail = String((imageUrl as Record<string, unknown>)?.detail ?? "auto");
        if (!url) return c;
        if (url.startsWith("data:")) return { type: "input_image", image_url: url, detail };
        const fetched = await fetchImageAsBase64(url, { timeoutMs: 15000 });
        return { type: "input_image", image_url: fetched?.url || url, detail };
      });
      item.content = await Promise.all(pending);
    }
  }

  async execute(args: ExecuteArgs) {
    const input = args.body?.input;
    const imgCount = Array.isArray(input) ? (input as Record<string, unknown>[]).reduce((n: number, it: Record<string, unknown>) => n + (Array.isArray(it.content) ? (it.content as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c.type === "image_url").length : 0), 0) : 0;
    const inputLen = Array.isArray(input) ? input.length : 0;
    dbg("CODEX", `execute start | inputItems=${inputLen} | images=${imgCount} | sessionId=${this._currentSessionId || "pending"}`);
    if (imgCount > 0) {
      const t0 = Date.now();
      await this.prefetchImages(args.body);
      dbg("CODEX", `prefetchImages done | ${Date.now() - t0}ms`);
    } else {
      await this.prefetchImages(args.body);
    }

    // Retry loop for SSE-level overloaded errors (200 OK body contains event: error)
    // Reuses 503 retry config — same semantic: upstream temporarily unavailable
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const { attempts, delayMs } = resolveRetryEntry(retryConfig[503]);
    let attempt = 0;
    while (true) {
      const result = await super.execute(args);
      const peek = await this._peekSseTransientError(result.response);
      if (!peek.matched) {
        // Replace body with re-assembled stream (prefix bytes already read + rest)
        if (peek.replacementBody) {
          result.response = new Response(peek.replacementBody, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          });
        }
        return result;
      }
      if (peek.accountFallback) {
        args.log?.warn?.("RETRY", `CODEX | SSE account fallback "${peek.message}"`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || CODEX_MODEL_CAPACITY_MESSAGE);
        return result;
      }
      if (attempt >= attempts) {
        args.log?.warn?.("RETRY", `CODEX | SSE overloaded "${peek.matched}" — retries exhausted (${attempt}/${attempts})`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || peek.matched);
        return result;
      }
      attempt++;
      args.log?.debug?.("RETRY", `CODEX | SSE "${peek.matched}" retry ${attempt}/${attempts} after ${delayMs / 1000}s`);
      dbg("CODEX", `SSE overloaded "${peek.matched}" → retry ${attempt}/${attempts} in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Peek first N bytes of SSE body to detect upstream transient errors.
  // Returns { matched: string|null, message: string|null, accountFallback: boolean, replacementBody: ReadableStream|null }.
  // Caller must use replacementBody when no error matched (original body has been read).
  async _peekSseTransientError(response: Response) {
    if (!response || !response.ok || !response.body) return { matched: null, message: null, accountFallback: false, replacementBody: null };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: Uint8Array[] = [];
    let text = "";
    let matched = null;
    let accountFallback = false;
    try {
      while (text.length < CODEX_SSE_PEEK_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        text += decoder.decode(value, { stream: true });
        const lowerText = text.toLowerCase();
        const accountHit = CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS.find(p => lowerText.includes(p));
        if (accountHit) { matched = accountHit; accountFallback = true; break; }
        const retryHit = CODEX_SSE_RETRY_PATTERNS.find(p => lowerText.includes(p));
        if (retryHit) { matched = retryHit; break; }
        if (CODEX_SSE_USER_OUTPUT_PATTERNS.some(p => lowerText.includes(p))) break;
      }
    } catch (e: unknown) {
      dbg("CODEX", `peek read error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (matched) {
      try { await reader.cancel(); } catch { /* noop */ }
      try { reader.releaseLock(); } catch { /* noop */ }
      return { matched, message: extractSseErrorMessage(text, matched), accountFallback, replacementBody: null };
    }

    reader.releaseLock();

    // Re-assemble stream: prefix chunks + remaining upstream body
    const upstream = response.body;
    let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const replacementBody = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        upstreamReader = upstream.getReader();
      },
      async pull(controller) {
        try {
          if (!upstreamReader) { controller.close(); return; }
          const { done, value } = await upstreamReader.read();
          if (done) { controller.close(); return; }
          controller.enqueue(value);
        } catch (e) { controller.error(e); }
      },
      cancel(reason) {
        try { upstreamReader?.cancel(reason); } catch { /* noop */ }
      },
    });
    return { matched: null, message: null, accountFallback: false, replacementBody };
  }

  // Parse Codex usage_limit_reached to extract precise resetsAtMs; fallback to default otherwise
  parseError(response: Response, bodyText: string) {
    if (response.status === 429 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const err = json?.error;
        if (err?.type === "usage_limit_reached") {
          const now = Date.now();
          let resetsAtMs = null;
          if (typeof err.resets_at === "number" && err.resets_at > 0) {
            const ms = err.resets_at * 1000;
            if (ms > now) resetsAtMs = ms;
          }
          if (!resetsAtMs && typeof err.resets_in_seconds === "number" && err.resets_in_seconds > 0) {
            resetsAtMs = now + err.resets_in_seconds * 1000;
          }
          if (resetsAtMs) {
            return { status: 429, message: err.message || bodyText, resetsAtMs };
          }
        }
      } catch { /* fall through to default */ }
    }
    return super.parseError(response, bodyText);
  }

  /**
   * Transform request before sending - inject default instructions if missing.
   * Image fetching is handled separately in prefetchImages() so this stays sync.
   */
  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Credentials) {
    this._isCompact = !!body._compact;
    delete body._compact;
    this._currentSessionId = resolveCacheSessionId(body, credentials);

    normalizeCodexInput(body);
    body.stream = true;

    if (!body.instructions || (body.instructions as string).trim() === "") {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }
    body.store = false;

    if (!body.prompt_cache_key && this._currentSessionId) {
      body.prompt_cache_key = this._currentSessionId;
    }

    configureCodexReasoning(body, model);
    stripUnsupportedCodexParams(body);

    return body;
  }
}
