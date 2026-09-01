import crypto from "crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { OAUTH_ENDPOINTS, ANTIGRAVITY_HEADERS, AG_DEFAULT_TOOLS, AG_TOOL_SUFFIX } from "../config/appConstants";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { resolveSessionId } from "../utils/sessionManager";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { cleanJSONSchemaForAntigravity } from "../translator/formats/gemini";
import { DEFAULT_THINKING_AG_SIGNATURE } from "../config/defaultThinkingSignature";
import type { Credentials, Logger, RefreshResult } from "../services/types";

// Sanitize function name: Gemini requires [a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}
function sanitizeFunctionName(name: string) {
  if (!name) return "_unknown";
  let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
  return s.substring(0, 64);
}

const MAX_RETRY_AFTER_MS = 10000;
const ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS = 15000;
const MAX_ANTIGRAVITY_OUTPUT_TOKENS = 64000;
const ANTIGRAVITY_IDE_REQUEST_ID_RE = /^agent\/[^/]+\/\d+\/[^/]+\/\d+$/;

const ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS = [
  /high\s+traffic/i,
  /agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i,
  /capacity/i,
  /temporarily\s+unavailable/i,
  /timeout/i,
  /stream\s+(ended|closed|terminated|interrupted)/i,
  /empty\s+response/i,
];

const ANTIGRAVITY_TRANSIENT_STATUSES = new Set([
  HTTP_STATUS.SERVER_ERROR,
  HTTP_STATUS.BAD_GATEWAY,
  HTTP_STATUS.SERVICE_UNAVAILABLE,
  HTTP_STATUS.GATEWAY_TIMEOUT,
]);

// Fields Google generateContent rejects (Claude/OpenAI/Qwen thinking fields set at body root by thinkingUnified.js)
const ANTIGRAVITY_REQUEST_BLACKLIST = [
  "output_config",
  "thinking",
  "reasoning_effort",
  "reasoning",
  "enable_thinking",
  "thinking_budget",
  "thinkingConfig",
];

// Strip blacklisted fields from an object (used for both body.request and top-level body)
const stripBlacklisted = (obj: Record<string, unknown>) => {
  for (const key of ANTIGRAVITY_REQUEST_BLACKLIST) delete obj[key];
};

// Image generation model name patterns
const IMAGE_MODEL_PATTERNS = [
  /image/i,
  /imagen/i,
  /image-generation/i,
];

// Detect if a model is an image generation model
function isImageModel(model: string) {
  if (!model) return false;
  return IMAGE_MODEL_PATTERNS.some(p => p.test(model));
}

// Parse aspect ratio / resolution from model name suffixes
// e.g. "gemini-3.1-flash-image-16x9" -> { aspectRatio: "16:9" }
// e.g. "gemini-3.1-flash-image-1024x768" -> { aspectRatio: "4:3" }
function parseImageConfig(model: string) {
  const config: { aspectRatio: string } = { aspectRatio: "1:1" };
  const resMatch = model.match(/(\d+)x(\d+)$/);
  if (resMatch) {
    const w = parseInt(resMatch[1]);
    const h = parseInt(resMatch[2]);
    if (w <= 16 && h <= 16) {
      config.aspectRatio = `${w}:${h}`;
    } else {
      // Resolution like 1024x768 — derive aspect ratio
      const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
      const d = gcd(w, h);
      config.aspectRatio = `${w/d}:${h/d}`;
    }
  }
  return config;
}

function uuidFromSeed(seed: string) {
  const bytes = crypto.createHash("sha256").update(String(seed || "antigravity")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildIdeRequestId({ body, request, credentials, model, requestType }: { body: Record<string, unknown>; request: Record<string, unknown>; credentials: Credentials; model: string; requestType: string }) {
  if (ANTIGRAVITY_IDE_REQUEST_ID_RE.test((body?.requestId as string) || "")) {
    return body.requestId as string;
  }

  const sessionId = (request?.sessionId as string) || (body?.request as Record<string, unknown>)?.sessionId as string || credentials?._clientSessionId as string || credentials?.connectionId || credentials?.email || "anonymous";
  const conversationId = uuidFromSeed(`antigravity:conversation:${sessionId}`);
  const trajectoryId = uuidFromSeed(`antigravity:trajectory:${sessionId}:${model}:${requestType}`);
  const contentCount = Array.isArray(request?.contents) ? request.contents.length : 1;
  const step = Math.max(1, contentCount * 2 - 1);
  return `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`;
}

export class AntigravityExecutor extends BaseExecutor {
  _lastSessionId?: string;

  constructor() {
    super("antigravity", PROVIDERS.antigravity);
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    // Image generation MUST use non-streaming generateContent
    const forceNonStream = isImageModel(model);
    const action = (stream && !forceNonStream) ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  // sessionId comes from transformRequest output; base.execute runs transformRequest before
  // buildHeaders, so we read it from instance state cached there (fallback: explicit arg).
  buildHeaders(credentials: Credentials, _stream = true, _sessionId?: string | null) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": (this.config.headers as Record<string, string>)?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"],
    };
  }

  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Credentials) {
    const projectId = (credentials?.projectId as string) || this.generateProjectId();

    // OpenAI clients may include stream_options even for non-streaming calls.
    // Google generateContent rejects that combination before processing the request.
    if (stream !== true) delete body.stream_options;

    // ─── Image generation: completely different request structure ───
    if (isImageModel(model)) {
      const imageConfig = parseImageConfig(model);
      // Strip model name suffixes for the actual API model name
      const cleanModel = model.replace(/-(\d+)x(\d+)$/, "");

      // Build simplified contents — text-only, merge all user messages
      const contents: Record<string, unknown>[] = [];
      const srcContents = ((body.request as Record<string, unknown>)?.contents || body.contents || []) as Record<string, unknown>[];
      for (const c of srcContents) {
        const textParts = ((c.parts || []) as Record<string, unknown>[]).filter(p => p.text !== undefined).map(p => ({ text: p.text }));
        if (textParts.length > 0) {
          contents.push({ role: c.role || "user", parts: textParts });
        }
      }

      const sessionId = resolveSessionId({
        headers: credentials?.rawHeaders as Record<string, string> | undefined,
        body,
        connectionId: credentials?.email || credentials?.connectionId,
        scope: "antigravity",
      });

      this._lastSessionId = sessionId;
      const request: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: 1.0,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
          imageConfig,
        },
        sessionId,
        // No tools, no systemInstruction, no safetySettings for image gen
      };

      return {
        project: projectId,
        model: cleanModel,
        userAgent: "antigravity",
        requestType: "image_gen",
        requestId: buildIdeRequestId({ body, request, credentials, model: cleanModel, requestType: "image_gen" }),
        request,
      };
    }

    // ─── Standard (non-image) request ───
    // Fix contents for Claude models via Antigravity
    const contents = ((body.request as Record<string, unknown>)?.contents as Record<string, unknown>[])?.map(c => {
      let role = c.role as string;
      // functionResponse must be role "user" for Claude models
      if (((c.parts || []) as Record<string, unknown>[]).some(p => p.functionResponse)) {
        role = "user";
      }
      // Strip thought-only parts, keep thoughtSignature on functionCall parts (Gemini 3+ requires it)
      const parts = ((c.parts || []) as Record<string, unknown>[]).filter(p => {
        if (p.thought && !p.functionCall) return false;
        if (p.thoughtSignature && !p.functionCall && !p.text) return false;
        return true;
      });
      // Gemini 3+ rejects functionCall parts without thoughtSignature. Clients (Claude Code, IDE)
      // don't persist thoughtSignature in their history, so backfill the default signature on any
      // functionCall part that arrives without one.
      const needsBackfill = parts?.some(p => p.functionCall && !p.thoughtSignature) ?? false;
      if (role !== c.role || parts?.length !== (c.parts as unknown[])?.length || needsBackfill) {
        return {
          ...c, role,
          parts: needsBackfill
            ? parts.map(p => (p.functionCall && !p.thoughtSignature)
                ? { ...p, thoughtSignature: DEFAULT_THINKING_AG_SIGNATURE }
                : p)
            : parts,
        };
      }
      return c;
    });

    // Sanitize tool schemas and function names before sending to Antigravity.
    let tools = (body.request as Record<string, unknown>)?.tools as Record<string, unknown>[] | undefined;

    if (tools && tools.length > 0) {
      // Merge all groups into a single functionDeclarations group (Gemini expects 1 group)
      const seenToolNames = new Set<string>();
      const allDeclarations: Record<string, unknown>[] = [];
      for (const group of tools) {
        for (const fn of (group.functionDeclarations || []) as Record<string, unknown>[]) {
          const name = sanitizeFunctionName(fn.name as string);
          if (seenToolNames.has(name)) continue;
          seenToolNames.add(name);
          allDeclarations.push({
            ...fn,
            name,
            parameters: fn.parameters
              ? cleanJSONSchemaForAntigravity(structuredClone(fn.parameters as Record<string, unknown>))
              : { type: "object", properties: { reason: { type: "string", description: "Brief explanation" } }, required: ["reason"] }
          });
        }
      }
      tools = allDeclarations.length > 0 ? [{ functionDeclarations: allDeclarations }] : [];
    }

    // Strip tools/toolConfig (handled separately) and blacklisted fields that Google rejects
    const { tools: _originalTools, toolConfig: _originalToolConfig, ...requestWithoutTools } = (body.request || {}) as Record<string, unknown>;
    stripBlacklisted(requestWithoutTools as Record<string, unknown>);
    
    // Rewrite competitive system prompts (e.g. Zed IDE's Claude prompt) to prevent Antigravity from 
    // flagging the request and immediately blocking it with a 429 Quota Exhausted response.
    if ((requestWithoutTools.systemInstruction as Record<string, unknown>)?.parts) {
      const oldText = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
      for (const part of ((requestWithoutTools.systemInstruction as Record<string, unknown>).parts as Record<string, unknown>[])) {
        if (typeof part.text === "string" && part.text.includes(oldText)) {
          part.text = part.text.split(oldText).join("");
        }
      }
    }

    const generationConfig = { ...((requestWithoutTools.generationConfig || {}) as Record<string, unknown>) };
    if ((generationConfig.maxOutputTokens as number) > MAX_ANTIGRAVITY_OUTPUT_TOKENS) {
      generationConfig.maxOutputTokens = MAX_ANTIGRAVITY_OUTPUT_TOKENS;
    }

    const transformedRequest: Record<string, unknown> = {
      ...requestWithoutTools,
      generationConfig,
      ...(contents && { contents }),
      ...(tools && { tools }),
      sessionId: ((body.request as Record<string, unknown>)?.sessionId as string) || resolveSessionId({ headers: credentials?.rawHeaders as Record<string, string> | undefined, body, connectionId: credentials?.email || credentials?.connectionId, scope: "antigravity" }),
      safetySettings: undefined,
      ...((tools?.length ?? 0) > 0 && { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } })
    };

    // Strip blacklisted thinking fields from top-level body (set by thinkingUnified.js at root, not body.request)
    stripBlacklisted(body);

    this._lastSessionId = transformedRequest.sessionId as string; // cached for buildHeaders (base.execute order)

    return {
      ...body,
      project: projectId,
      model: body.model || model,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: buildIdeRequestId({ body, request: transformedRequest, credentials, model, requestType: "agent" }),
      request: transformedRequest
    };
  }

  async refreshCredentials(credentials: Credentials, log?: Logger, proxyOptions: unknown = null): Promise<RefreshResult | null> {
    if (!credentials.refreshToken) return null;

    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token as string, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken as string,
          client_id: this.config.clientId as string,
          client_secret: this.config.clientSecret as string
        })
      }, proxyOptions as null);

      if (!response.ok) return null;

      const tokens = await response.json() as Record<string, unknown>;
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token as string,
        refreshToken: (tokens.refresh_token as string) || credentials.refreshToken as string,
        expiresIn: tokens.expires_in as number,
        projectId: credentials.projectId as string
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log?.error?.("TOKEN", `Antigravity refresh error: ${error.message}`);
      return null;
    }
  }

  generateProjectId() {
    const adj = ["useful", "bright", "swift", "calm", "bold"][Math.floor(Math.random() * 5)];
    const noun = ["fuze", "wave", "spark", "flow", "core"][Math.floor(Math.random() * 5)];
    return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
  }

  generateSessionId() {
    return crypto.randomUUID() + Date.now().toString();
  }

  parseRetryHeaders(headers: Headers) {
    if (!headers?.get) return null;

    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
      }
    }

    const resetAfter = headers.get('x-ratelimit-reset-after');
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }

    const resetTimestamp = headers.get('x-ratelimit-reset');
    if (resetTimestamp) {
      const ts = parseInt(resetTimestamp, 10) * 1000;
      const diff = ts - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  // Parse retry time from Antigravity error message body
  // Format: "Your quota will reset after 2h7m23s" or "1h30m" or "45m" or "30s"
  parseRetryFromErrorMessage(errorMessage: string) {
    if (!errorMessage || typeof errorMessage !== "string") return null;

    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000; // hours
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000; // minutes
    if (match[3]) totalMs += parseInt(match[3]) * 1000; // seconds

    return totalMs > 0 ? totalMs : null;
  }

  extractErrorMessage(errorJson: Record<string, unknown> | null, bodyText = "") {
    return [
      (errorJson?.error as Record<string, unknown>)?.message,
      errorJson?.message,
      errorJson?.error,
      bodyText,
    ].filter(Boolean).map(v => typeof v === "string" ? v : JSON.stringify(v)).join("\n");
  }

  isTransientAntigravityError(status: number, message: string) {
    if (status === HTTP_STATUS.RATE_LIMITED) return true;
    if (ANTIGRAVITY_TRANSIENT_STATUSES.has(status)) return true;
    return ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message || ""));
  }

  // Hook called by BaseExecutor.tryRetry: derive delay from Retry-After (header → body),
  // cap at MAX_RETRY_AFTER_MS, else retry transient Antigravity failures with backoff.
  // Return false to veto (fallback URL / final error).
  async computeRetryDelay(response: Response, attempt: number, _delayMs?: number): Promise<number | false> {
    let bodyText = "";
    let errorJson: Record<string, unknown> | null = null;
    let retryMs = this.parseRetryHeaders(response.headers);

    try {
      bodyText = await response.clone().text();
      errorJson = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : null;
    } catch {
      // ignore parse errors → fall through to status/message based retry
    }

    const errorMessage = this.extractErrorMessage(errorJson, bodyText);

    if (!retryMs) {
      retryMs = this.parseRetryFromErrorMessage(errorMessage);
    }
    if (retryMs) return retryMs <= MAX_RETRY_AFTER_MS ? retryMs : false;

    if (!this.isTransientAntigravityError(response.status, errorMessage)) return false;

    const cap = response.status === HTTP_STATUS.RATE_LIMITED
      ? MAX_RETRY_AFTER_MS
      : ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS;
    return Math.min(1000 * (2 ** attempt), cap); // exponential backoff
  }

  /**
   * Cloak tools before sending to Antigravity provider (anti-ban):
   * - Rename client tools with _ide suffix
   * - Inject AG default decoy tools after client tools
   * Returns { cloakedBody, toolNameMap } where toolNameMap maps suffixed → original
   */
  static cloakTools(body: Record<string, unknown>, clientTool: string | null = null) {
    const tools = ((body.request as Record<string, unknown>)?.tools) as Record<string, unknown>[] | undefined;
    if (!tools || tools.length === 0) {
      return { cloakedBody: body, toolNameMap: null };
    }

    const isCopilot = clientTool === "github-copilot";
    const toolNameMap = new Map<string, string>();
    const clientDeclarations: Record<string, unknown>[] = [];
    const decoyNames = new Set(AG_DECOY_TOOLS.map(tool => tool.name));

    // First: collect renamed client tools
    for (const toolGroup of tools) {
      if (!toolGroup.functionDeclarations) continue;

      for (const func of toolGroup.functionDeclarations as Record<string, unknown>[]) {
        // For GitHub Copilot, avoid emitting duplicate native Antigravity tool names.
        // Keep the decoys only once in the final declaration list.
        if (isCopilot && AG_DEFAULT_TOOLS.has(func.name as string)) {
          continue;
        }

        // Skip if already covered by decoys for Copilot
        if (isCopilot && decoyNames.has(func.name as string)) {
          continue;
        }

        // Preserve native AG names for non-Copilot clients
        if (AG_DEFAULT_TOOLS.has(func.name as string)) {
          clientDeclarations.push(func);
          continue;
        }

        const suffixed = `${func.name}${AG_TOOL_SUFFIX}`;
        toolNameMap.set(suffixed, func.name as string);
        clientDeclarations.push({ ...func, name: suffixed });
      }
    }

    // Client tools first, then AG decoy tools
    const allDeclarations: Record<string, unknown>[] = [];
    const seenNames = new Set<string>();
    for (const decl of [...clientDeclarations, ...AG_DECOY_TOOLS]) {
      if (!decl?.name || seenNames.has(decl.name as string)) continue;
      seenNames.add(decl.name as string);
      allDeclarations.push(decl);
    }

    // Rename tool names in conversation history (contents)
    const cloakedContents = ((body.request as Record<string, unknown>)?.contents as Record<string, unknown>[])?.map(msg => {
      if (!msg.parts) return msg;
      
      const cloakedParts = ((msg.parts || []) as Record<string, unknown>[]).map(part => {
        // Rename functionCall.name
        if (part.functionCall && !AG_DEFAULT_TOOLS.has((part.functionCall as Record<string, unknown>).name as string)) {
          return {
            ...part,
            functionCall: {
              ...(part.functionCall as Record<string, unknown>),
              name: `${(part.functionCall as Record<string, unknown>).name}${AG_TOOL_SUFFIX}`
            }
          };
        }
        
        // Rename functionResponse.name
        if (part.functionResponse && !AG_DEFAULT_TOOLS.has((part.functionResponse as Record<string, unknown>).name as string)) {
          return {
            ...part,
            functionResponse: {
              ...(part.functionResponse as Record<string, unknown>),
              name: `${(part.functionResponse as Record<string, unknown>).name}${AG_TOOL_SUFFIX}`
            }
          };
        }
        
        return part;
      });
      
      return { ...msg, parts: cloakedParts };
    });

    // Single functionDeclarations group: client tools first, then decoys
    return {
      cloakedBody: {
        ...body,
        request: {
          ...(body.request as Record<string, unknown>),
          tools: [{ functionDeclarations: allDeclarations }],
          contents: cloakedContents || (body.request as Record<string, unknown>).contents
        }
      },
      toolNameMap
    };
  }
}

// AG decoy tools — same names as AG native defaults, redirect to _ide suffixed tools
const AG_DECOY_TOOLS = [
  {
    name: "browser_subagent",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "command_status",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "find_by_name",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "generate_image",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "grep_search",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "list_dir",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "list_resources",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "mcp_sequential-thinking_sequentialthinking",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "multi_replace_file_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "notify_user",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "read_resource",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "read_terminal",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "read_url_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "replace_file_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "run_command",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "search_web",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "send_command_input",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "task_boundary",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "view_content_chunk",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "view_file",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "write_to_file",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  }
];

export default AntigravityExecutor;
