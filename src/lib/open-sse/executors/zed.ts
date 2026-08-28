// ZedHostedExecutor — routes requests to Zed's hosted LLM aggregator
// (cloud.zed.dev/completions), a multi-format proxy fronting
// Anthropic/OpenAI/Google/xAI depending on the requested model.
//
// Wire protocol: POST /completions with an NDJSON/SSE-ish body-per-line
// response stream (`{"event": <provider-shaped-chunk>}` / `{"status": ...}` /
// `[DONE]`), authenticated with a short-lived LLM bearer token exchanged from
// the RSA-decrypted access_token (see open-sse/shared/zedAuth.js). The
// provider-shaped chunk is Claude/Gemini/OpenAI-Responses/xAI(OpenAI-shaped)
// depending on which upstream Zed fronts for the model — translated back to
// OpenAI Chat Completions by reusing the existing translators.
//
// Overrides execute() entirely (does NOT use DefaultExecutor's pipeline) because the Zed wire
// shape (thread envelope, LLM-token exchange, NDJSON status frames) doesn't
// fit the generic transformRequest/buildUrl contract.

import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { FORMATS } from "../translator/formats";
import { initState } from "../translator/index";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude";
import { openaiToGeminiRequest } from "../translator/request/openai-to-gemini";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses";
import { claudeToOpenAIResponse } from "../translator/response/claude-to-openai";
import { geminiToOpenAIResponse } from "../translator/response/gemini-to-openai";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses";
import {
  ZED_HEADERS,
  resolveZedModels,
  zedLlmFetch,
} from "../shared/zedAuth";
import type { Credentials, Logger } from "../services/types";

const ZED_PROVIDER: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAi",
  google: "Google",
  xai: "XAi",
};

function normalizeZedProvider(value: unknown, model: string) {
  const raw = String(value || "").toLowerCase();
  if (raw === "anthropic") return ZED_PROVIDER.anthropic;
  if (raw === "openai" || raw === "open_ai") return ZED_PROVIDER.openai;
  if (raw === "google" || raw === "gemini") return ZED_PROVIDER.google;
  if (raw === "xai" || raw === "x_ai" || raw === "x-ai") return ZED_PROVIDER.xai;

  const m = String(model || "").toLowerCase();
  if (m.includes("claude")) return ZED_PROVIDER.anthropic;
  if (m.includes("gemini")) return ZED_PROVIDER.google;
  if (m.includes("grok") || m.includes("xai")) return ZED_PROVIDER.xai;
  return ZED_PROVIDER.openai;
}

function buildProviderRequest(provider: string, model: string, body: Record<string, unknown>, stream: boolean, credentials: Credentials) {
  if (provider === ZED_PROVIDER.anthropic) {
    return openaiToClaudeRequest(model, body, true);
  }
  if (provider === ZED_PROVIDER.google) {
    return openaiToGeminiRequest(model, body, true);
  }
  if (provider === ZED_PROVIDER.openai) {
    return openaiToOpenAIResponsesRequest(model, body, true, credentials);
  }
  // xAI is OpenAI-shaped — forward as-is.
  return { ...(body || {}), model, stream: stream !== false };
}

function initProviderState(provider: string, model: string) {
  if (provider === ZED_PROVIDER.anthropic) return initState(FORMATS.CLAUDE);
  if (provider === ZED_PROVIDER.google) return initState(FORMATS.GEMINI);
  if (provider === ZED_PROVIDER.openai) return initState(FORMATS.OPENAI_RESPONSES);
  const state = initState(FORMATS.OPENAI) as Record<string, unknown>;
  state.model = model;
  return state;
}

function convertProviderEvent(provider: string, event: unknown, state: Record<string, unknown>) {
  if (provider === ZED_PROVIDER.anthropic) return claudeToOpenAIResponse(event as Record<string, unknown>, state);
  if (provider === ZED_PROVIDER.google) return geminiToOpenAIResponse(event as Record<string, unknown>, state);
  if (provider === ZED_PROVIDER.openai) return openaiResponsesToOpenAIResponse(event, state);
  return event;
}

function createErrorChunk(model: string, message: string) {
  return {
    id: `chatcmpl-zed-error-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, delta: { content: `[Zed error] ${message}` }, finish_reason: "stop" },
    ],
  };
}

function enqueueSseObject(controller: TransformStreamDefaultController, encoder: TextEncoder, chunk: unknown) {
  if (!chunk) return;
  const items = Array.isArray(chunk) ? chunk : [chunk];
  for (const item of items) {
    if (!item) continue;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
  }
}

function unwrapZedLine(line: string) {
  let text = line.replace(/\r$/, "").trim();
  if (!text) return null;
  if (text.startsWith("data:")) text = text.slice(5).trimStart();
  if (text === "[DONE]") return { done: true };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "event")) {
      return { event: parsed.event };
    }
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, "status")) {
      return { status: parsed.status };
    }
    return { event: parsed };
  } catch {
    return null;
  }
}

function normalizeStatus(status: unknown) {
  if (!status) return null;
  if (typeof status === "string") return { type: status };
  if (typeof status === "object") {
    const key = Object.keys(status as Record<string, unknown>)[0];
    if (key && typeof (status as Record<string, unknown>)[key] === "object") return { type: key, ...((status as Record<string, unknown>)[key] as Record<string, unknown>) };
    return status as Record<string, unknown>;
  }
  return null;
}

function wrapZedCompletionStream(response: Response, provider: string, model: string) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = initProviderState(provider, model) as Record<string, unknown>;
  let buffer = "";
  let done = false;

  const finish = (controller: TransformStreamDefaultController) => {
    if (done) return;
    const finalChunk = convertProviderEvent(provider, null, state);
    enqueueSseObject(controller, encoder, finalChunk);
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    done = true;
  };

  const processLine = (line: string, controller: TransformStreamDefaultController) => {
    if (done) return;
    const payload = unwrapZedLine(line);
    if (!payload) return;
    if (payload.done) {
      finish(controller);
      return;
    }
    if (payload.status) {
      const status = normalizeStatus(payload.status);
      if (status?.type === "failed" || (status as Record<string, unknown>)?.failed) {
        const failed = ((status as Record<string, unknown>)?.failed as Record<string, unknown>) || status;
        const message = String(failed.message || failed.error || failed.code || "request failed");
        enqueueSseObject(controller, encoder, createErrorChunk(model, message));
        finish(controller);
      } else if (status?.type === "stream_ended") {
        finish(controller);
      }
      return;
    }
    const converted = convertProviderEvent(provider, payload.event, state);
    enqueueSseObject(controller, encoder, converted);
  };

  const transformed = response.body.pipeThrough(
    new TransformStream({
      transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          processLine(line, controller);
        }
      },
      flush(controller: TransformStreamDefaultController) {
        buffer += decoder.decode();
        if (buffer) {
          processLine(buffer, controller);
          buffer = "";
        }
        finish(controller);
      },
    }),
  );

  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

class ZedExecutor extends BaseExecutor {
  constructor() {
    super("zed", PROVIDERS.zed);
  }

  async resolveModel(model: string, credentials: Credentials, signal?: AbortSignal, log?: Logger) {
    try {
      const catalog = await resolveZedModels(credentials, { config: this.config as unknown as Record<string, unknown>, signal });
      let raw = catalog?.rawById?.get(model) ?? null;
      if (!raw) {
        const refreshed = await resolveZedModels(credentials, {
          config: this.config as unknown as Record<string, unknown>,
          signal,
          forceRefresh: true,
        });
        raw = refreshed?.rawById?.get(model) ?? null;
      }
      return { raw, provider: normalizeZedProvider(raw?.provider, model) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.warn?.("ZED", `model catalog unavailable, inferring provider for ${model}: ${message}`);
      return { raw: null, provider: normalizeZedProvider(null, model) };
    }
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger; proxyOptions?: unknown }) {
    const { provider } = await this.resolveModel(model, credentials, signal, log);
    const providerRequest = buildProviderRequest(provider, model, body, stream, credentials);
    const bodyRecord = body || {};
    const payload: Record<string, unknown> = {
      thread_id: bodyRecord.thread_id || credentials?._clientSessionId,
      prompt_id: bodyRecord.prompt_id,
      provider,
      model,
      provider_request: providerRequest,
    };

    const response = await zedLlmFetch(credentials, "/completions", {
      config: this.config as unknown as Record<string, unknown>,
      signal,
      fetchOptions: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, text/event-stream, */*",
          "User-Agent": "9router/zed",
          "x-zed-version": (this.config?.appVersion?.toString() as string) || "0.200.0",
          [ZED_HEADERS.clientSupportsStatus]: "true",
          [ZED_HEADERS.clientSupportsStreamEnded]: "true",
        },
        body: JSON.stringify(payload),
      },
    });

    const wrapped = response.ok ? wrapZedCompletionStream(response as Response, provider, model) : response;
    return {
      response: wrapped as Response,
      url: `${(this.config?.llmBaseUrl as string) || "https://cloud.zed.dev"}/completions`,
      headers: { "Content-Type": "application/json", Authorization: "Bearer <zed-llm-token>" } as Record<string, string>,
      transformedBody: payload,
    };
  }

  parseError(response: Response, bodyText: string) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(bodyText || "{}") as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    const errorObj = parsed?.error as Record<string, unknown> | undefined;
    const code = (parsed?.code as string) || (errorObj?.code as string) || "";
    const rawMessage =
      (parsed?.message as string) || (errorObj?.message as string) || bodyText || response.statusText;
    if (code === "trial_blocked") {
      return {
        status: response.status,
        message: `Zed trial access is blocked upstream. The account can list hosted models, but Zed is refusing completions until trial/billing access is enabled or unblocked. Zed says: ${rawMessage}`,
      };
    }
    if (code) {
      return { status: response.status, message: `Zed ${code}: ${rawMessage}` };
    }
    return { status: response.status, message: rawMessage || `Zed upstream error: ${response.status}` };
  }

  async refreshCredentials() {
    // Zed uses a long-lived RSA-decrypted access_token — no OAuth refresh.
    return null;
  }

  needsRefresh() {
    return false;
  }
}

export default ZedExecutor;
