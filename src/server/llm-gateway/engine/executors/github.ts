import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT } from "../config/appConstants";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses";
import { initState, translateRequest, translateResponse } from "../translator/index";
import { FORMATS } from "../translator/formats";
import { parseSSELine, formatSSE } from "../utils/streamHelpers";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport";
import { SSE_DONE } from "../utils/sseConstants";
import { ANTHROPIC_API_VERSION } from "../providers/shared";
import crypto from "crypto";
import type { Credentials, Logger, RefreshResult } from "../services/types";
import type { ExecuteArgs } from "./base";

function createClaudeToOpenAITransformStream(
  model: string,
  stream: boolean,
  state: Record<string, unknown>
) {
  const decoder = new TextDecoder();
  let buffer = "";

  const emitAll = (controller: TransformStreamDefaultController, chunks: unknown[]) => {
    for (const c of chunks) {
      controller.enqueue(new TextEncoder().encode(formatSSE(c, "openai")));
    }
  };

  return new TransformStream({
    async transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = parseSSELine(trimmed);
        if (!parsed) continue;
        if (parsed.done && stream === true) {
          controller.enqueue(new TextEncoder().encode(SSE_DONE));
          continue;
        }
        emitAll(controller, translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, parsed, state));
      }
    },
    flush(controller: TransformStreamDefaultController) {
      if (buffer.trim()) {
        const parsed = parseSSELine(buffer.trim());
        if (parsed && !parsed.done) {
          emitAll(controller, translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, parsed, state));
        }
      }
    }
  });
}

export class GithubExecutor extends BaseExecutor {
  knownCodexModels: Set<string>;

  constructor() {
    super("github", PROVIDERS.github);
    this.knownCodexModels = new Set();
  }

  // Claude models get routed to Copilot's Anthropic-native /v1/messages shim (see
  // executeWithMessagesEndpoint below) — the only Copilot endpoint that surfaces
  // prompt-cache token counts. gpt/gemini/grok models stay on /chat/completions
  // (or /responses). Name-pattern check, not a registry field: Copilot's live model
  // catalog (services/copilotModels.js) regularly exposes claude-* variants ahead
  // of the static registry (registry/github.js).
  isClaudeModel(model: string) {
    return /claude/i.test(model || "");
  }

  buildUrl(_model: string, _stream: boolean, _urlIndex = 0) {
    return this.config.baseUrl as string;
  }

  buildHeaders(credentials: Credentials, stream = true) {
    const token = credentials.copilotToken || credentials.accessToken;
    return {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "copilot-integration-id": "vscode-chat",
      "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
      "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
      "user-agent": GITHUB_COPILOT.USER_AGENT || "",
      "openai-intent": "conversation-panel",
      "x-github-api-version": GITHUB_COPILOT.API_VERSION || "",
      "x-request-id": crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      // Harmless no-op on /chat/completions and /responses; required by /v1/messages.
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  // Sanitize messages for GitHub Copilot /chat/completions endpoint (gpt/gemini/grok models —
  // claude models never reach this, see execute() below).
  // The endpoint only accepts 'text' and 'image_url' content part types.
  // Tool-related content (tool_use, tool_result, thinking) must be serialized as text.
  sanitizeMessagesForChatCompletions(body: Record<string, unknown>) {
    if (!body?.messages) return body;

    const sanitized = { ...body };
    sanitized.messages = (body.messages as Record<string, unknown>[]).map(msg => {
      // assistant messages with only tool_calls have content: null — leave as-is
      if (!msg.content) return msg;

      // String content is always fine
      if (typeof msg.content === "string") return msg;

      // Array content: filter/convert unsupported part types
      if (Array.isArray(msg.content)) {
        const cleanContent = msg.content
          .map((part: Record<string, unknown>) => {
            if (part.type === "text") return part;
            if (part.type === "image_url") return part;
            // Serialize tool_use, tool_result, thinking, etc. as text
            const text = part.text || part.content || JSON.stringify(part);
            return { type: "text", text: typeof text === "string" ? text : JSON.stringify(text) };
          })
          .filter((part: Record<string, unknown>) => part.text !== ""); // remove empty text parts

        // If all content was stripped (e.g. only tool_result with no text), drop content
        return { ...msg, content: cleanContent.length > 0 ? cleanContent : null };
      }

      return msg;
    });

    return sanitized;
  }

  // Newer OpenAI models (gpt-5+, o1, o3, o4) require max_completion_tokens instead of max_tokens
  requiresMaxCompletionTokens(model: string) {
    return /gpt-5|o[134]-/i.test(model);
  }

  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, _credentials?: Credentials) {
    const transformed = { ...body };
    if (this.requiresMaxCompletionTokens(model) && transformed.max_tokens !== undefined) {
      transformed.max_completion_tokens = transformed.max_tokens;
      delete transformed.max_tokens;
    }
    // "none" means no thinking — strip it so models that don't support "none" don't 400
    if (transformed.reasoning_effort === "none") {
      delete transformed.reasoning_effort;
    }
    // Config-driven strip of params unsupported by this provider/model
    stripUnsupportedParams("github", model, transformed);
    return transformed;
  }

  // GitHub Copilot's /responses endpoint only serves OpenAI (gpt/codex) models.
  // Gemini and Claude models are not available there and reject with a 400
  // "does not support Responses API" (unsupported_api_for_model). They must
  // therefore never be escalated to /responses, even if /chat/completions
  // returned a "not supported" error for an unrelated reason. Fixes #1062.
  supportsResponsesEndpoint(model: string) {
    const m = (model || "").toLowerCase();
    return !(m.includes("gemini") || m.includes("claude"));
  }

  async execute(options: ExecuteArgs) {
    const { model, log } = options;

    // Claude models: route to Copilot's Anthropic-native /v1/messages shim — the only
    // Copilot endpoint that surfaces prompt-cache token counts for Claude. Detected by
    // model NAME (not a registry field): Copilot's live model catalog regularly exposes
    // claude-* variants the static registry hasn't caught up with yet (see registry/github.js).
    if (this.isClaudeModel(model)) {
      log?.debug?.("GITHUB", `Using /v1/messages route for ${model}`);
      return this.executeWithMessagesEndpoint(options);
    }

    // Only use /responses for models that are explicitly known to need it (e.g. gpt codex models)
    // and that the /responses endpoint actually serves (excludes Gemini/Claude, see #1062).
    if (this.knownCodexModels.has(model) && this.supportsResponsesEndpoint(model)) {
      log?.debug?.("GITHUB", `Using cached /responses route for ${model}`);
      return this.executeWithResponsesEndpoint(options);
    }

    // Sanitize messages before sending to /chat/completions (gpt/gemini/grok — the
    // endpoint rejects non-text/image_url content parts).
    const sanitizedOptions = {
      ...options,
      body: this.sanitizeMessagesForChatCompletions(options.body as Record<string, unknown>)
    };

    const result = await super.execute(sanitizedOptions as unknown as import("./base").ExecuteArgs);

    // Only escalate to /responses for models that endpoint can actually serve.
    // Gemini/Claude would otherwise loop into a misleading "does not support
    // Responses API" 400 instead of surfacing the real /chat/completions error (#1062).
    if (result.response.status === HTTP_STATUS.BAD_REQUEST && this.supportsResponsesEndpoint(model)) {
      const errorBody = await result.response.clone().text();

      if (errorBody.includes("not accessible via the /chat/completions endpoint") || errorBody.includes("The requested model is not supported")) {
        log?.warn?.("GITHUB", `Model ${model} requires /responses. Switching...`);
        this.knownCodexModels.add(model);
        return this.executeWithResponsesEndpoint(options);
      }
    }

    return result;
  }

  async executeWithResponsesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger; proxyOptions?: unknown }) {
    const url = (this.config.responsesUrl as string) || (this.config.baseUrl as string);
    const headers = this.buildHeaders(credentials, stream);

    const transformedBody = openaiToOpenAIResponsesRequest(model, body, stream, credentials);

    log?.debug?.("GITHUB", "Sending translated request to /responses");

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal
    }, proxyOptions as null);

    if (!response.ok) {
      return { response, url, headers, transformedBody };
    }

    const state = initState("openai-responses") as Record<string, unknown>;
    state.model = model;

    const decoder = new TextDecoder();
    let buffer = "";

    const transformStream = new TransformStream({
      async transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");

        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const parsed = parseSSELine(trimmed);
          if (!parsed) continue;

          if (parsed.done && stream === true) {
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            continue;
          }

          const converted = openaiResponsesToOpenAIResponse(parsed, state);
          if (converted) {
            const sseString = formatSSE(converted, "openai");
            controller.enqueue(new TextEncoder().encode(sseString));
          }
        }
      },
      flush(controller: TransformStreamDefaultController) {
        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed && !parsed.done) {
            const converted = openaiResponsesToOpenAIResponse(parsed, state);
            if (converted) {
              controller.enqueue(new TextEncoder().encode(formatSSE(converted, "openai")));
            }
          }
        }
      }
    });

    if (!response.body) {
      return { response: new Response("", { status: response.status, headers: response.headers }), url, headers, transformedBody };
    }
    const convertedStream = response.body.pipeThrough(transformStream);

    return {
      response: new Response(convertedStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      }),
      url,
      headers,
      transformedBody
    };
  }

  // Claude models arrive here OpenAI-shape (chatCore.js targets "openai" for github —
  // see the note in execute() above), so we translate to Anthropic-native ourselves.
  // This is what makes prepareClaudeRequest() (translator/formats/claude.js) inject
  // cache_control — /chat/completions never gets there, so it never sees cache tokens.
  async executeWithMessagesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger; proxyOptions?: unknown }) {
    const url = (this.config.messagesUrl as string) || (this.config.baseUrl as string);
    const headers = this.buildHeaders(credentials, stream);

    const transformedBody = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, body, true, credentials, "github");
    const toolNameMap = (transformedBody as Record<string, unknown>)._toolNameMap;
    delete (transformedBody as Record<string, unknown>)._toolNameMap;

    log?.debug?.("GITHUB", "Sending translated request to /v1/messages");

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal
    }, proxyOptions as null);

    if (!response.ok) {
      return { response, url, headers, transformedBody };
    }

    const state = initState(FORMATS.CLAUDE) as Record<string, unknown>;
    state.model = model;
    if (toolNameMap) state.toolNameMap = toolNameMap;

    if (!response.body) {
      return { response: new Response("", { status: response.status, headers: response.headers }), url, headers, transformedBody };
    }

    const transformStream = createClaudeToOpenAITransformStream(model, stream, state);
    const convertedStream = response.body.pipeThrough(transformStream);

    return {
      response: new Response(convertedStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      }),
      url,
      headers,
      transformedBody
    };
  }

  async refreshCopilotToken(githubAccessToken: string, log?: Logger, proxyOptions: unknown = null) {
    try {
      const response = await proxyAwareFetch("https://api.github.com/copilot_internal/v2/token", {
        headers: {
          "Authorization": `token ${githubAccessToken}`,
          "User-Agent": GITHUB_COPILOT.USER_AGENT,
          "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
          "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
          "Accept": "application/json",
          "x-github-api-version": GITHUB_COPILOT.API_VERSION
        } as Record<string, string>
      }, proxyOptions as null);
      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN", `Copilot token refresh failed: ${response.status} ${errorText}`);
        return null;
      }
      const data = await response.json() as Record<string, unknown>;
      log?.info?.("TOKEN", "Copilot token refreshed");
      return { token: data.token as string, expiresAt: data.expires_at as string };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log?.error?.("TOKEN", `Copilot refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshGitHubToken(refreshToken: string, log?: Logger, proxyOptions: unknown = null) {
    try {
      const params: Record<string, string> = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId as string,
      };
      if (this.config.clientSecret) {
        params.client_secret = this.config.clientSecret as string;
      }

      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.github.token as string, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams(params)
      }, proxyOptions as null);
      if (!response.ok) return null;
      const tokens = await response.json() as Record<string, unknown>;
      log?.info?.("TOKEN", "GitHub token refreshed");
      return { accessToken: tokens.access_token as string, refreshToken: (tokens.refresh_token as string) || refreshToken, expiresIn: tokens.expires_in as number };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log?.error?.("TOKEN", `GitHub refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshCredentials(credentials: Credentials, log?: Logger, proxyOptions: unknown = null): Promise<RefreshResult | null> {
    let copilotResult = await this.refreshCopilotToken(credentials.accessToken as string, log, proxyOptions);

    if (!copilotResult && credentials.refreshToken) {
      const githubTokens = await this.refreshGitHubToken(credentials.refreshToken as string, log, proxyOptions);
      if (githubTokens?.accessToken) {
        copilotResult = await this.refreshCopilotToken(githubTokens.accessToken, log, proxyOptions);
        if (copilotResult) {
          return { ...githubTokens, copilotToken: copilotResult.token, copilotTokenExpiresAt: copilotResult.expiresAt };
        }
        return githubTokens;
      }
    }

    if (copilotResult) {
      return { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken as string, copilotToken: copilotResult.token, copilotTokenExpiresAt: copilotResult.expiresAt };
    }

    return null;
  }

  needsRefresh(credentials: Credentials) {
    // Always refresh if no copilotToken
    if (!credentials.copilotToken) return true;

    if (credentials.copilotTokenExpiresAt) {
      // Handle both Unix timestamp (seconds) and ISO string
      let expiresAtMs = credentials.copilotTokenExpiresAt as number | string;
      if (typeof expiresAtMs === "number" && expiresAtMs < 1e12) {
        expiresAtMs = expiresAtMs * 1000; // Convert seconds to ms
      } else if (typeof expiresAtMs === "string") {
        expiresAtMs = new Date(expiresAtMs).getTime();
      }
      if ((expiresAtMs as number) - Date.now() < 5 * 60 * 1000) return true;
    }
    return super.needsRefresh(credentials);
  }
}

export default GithubExecutor;
