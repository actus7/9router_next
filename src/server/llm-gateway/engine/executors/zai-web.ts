// Z.ai (chat.z.ai) signed-API executor.
//
// Ported from OmniRoute's zai-web executor (Option B: signed HTTP API only —
// the browser-automation fallback transport was intentionally not brought
// over). See zai-web/protocol.ts and zai-web/stream.ts for the reverse-
// engineered wire format this talks.
import { BaseExecutor } from "./base";
import type { Credentials, Logger } from "../services/types";
import {
  ZAI_CHAT_URL,
  ZAI_DEFAULT_FE_VERSION,
  ZAI_DEFAULT_MODEL,
  ZAI_FE_VERSION_CACHE_TTL_MS,
  ZAI_NEW_CHAT_URL,
  ZAI_USER_AGENT,
  buildZaiCompletionUrl,
  buildZaiHeaders,
  buildZaiNewChatBody,
  buildZaiRequestBody,
  buildZaiSignature,
  extractZaiToken,
  extractZaiUserId,
  latestUserPrompt,
  parseZaiFrontendVersion,
  resolveZaiCaptchaVerifyParam,
  resolveZaiThinkingConfig,
  resolveZaiWebSearch,
  sanitizeErrorMessage,
  type ZaiReasoningEffort,
  type ZaiThinkingConfig,
} from "./zai-web/protocol";
import {
  buildZaiStreamingBody,
  collectZaiNonStreaming,
  makeZaiChunkEmitter,
} from "./zai-web/stream";

let cachedFeVersion: { value: string; expiresAt: number } | null = null;

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface ResolvedZaiRequest {
  captchaVerifyParam: string;
  messages: Array<{ role: string; content: unknown }>;
  modelId: string;
  prompt: string;
  thinkingConfig: ZaiThinkingConfig;
  token: string;
  userId: string;
  webSearchEnabled: boolean;
}

function resolveZaiRequest(
  body: Record<string, unknown>,
  credentials: Credentials,
  model: string
): { request: ResolvedZaiRequest } | { error: { status: number; message: string } } {
  const rawCredential = String(credentials?.apiKey ?? credentials?.accessToken ?? "").trim();
  const token = extractZaiToken(rawCredential);
  if (!token) {
    return {
      error: {
        status: 400,
        message: 'Missing Z.ai web-session credential — copy the "token" value from chat.z.ai Local Storage.',
      },
    };
  }

  const messages = (body.messages as Array<{ role: string; content: unknown }>) || [];
  const prompt = latestUserPrompt(messages);
  if (!prompt) {
    return { error: { status: 400, message: "Z.ai requires at least one user message" } };
  }

  const modelId = (body.model as string) || model || ZAI_DEFAULT_MODEL;

  const userId = extractZaiUserId(token);
  if (!userId) {
    return {
      error: {
        status: 400,
        message: "Invalid Z.ai web-session credential — its JWT payload does not contain the required user id.",
      },
    };
  }

  const captchaVerifyParam = resolveZaiCaptchaVerifyParam(credentials, body);
  if (!captchaVerifyParam) {
    return {
      error: {
        status: 400,
        message:
          'Missing Z.ai captcha_verify_param — capture it from a real chat.z.ai request (DevTools → Network → chat completion request body) and paste it alongside your token, e.g. {"token":"...","captcha_verify_param":"..."}.',
      },
    };
  }

  return {
    request: {
      captchaVerifyParam,
      messages,
      modelId,
      prompt,
      thinkingConfig: resolveZaiThinkingConfig(modelId, body),
      token,
      userId,
      webSearchEnabled: resolveZaiWebSearch(modelId, body),
    },
  };
}

export class ZaiWebExecutor extends BaseExecutor {
  constructor() {
    super("zai-web", { baseUrl: ZAI_CHAT_URL });
  }

  private async resolveFrontendVersion(signal?: AbortSignal): Promise<string> {
    if (cachedFeVersion && cachedFeVersion.expiresAt > Date.now()) return cachedFeVersion.value;
    let version = ZAI_DEFAULT_FE_VERSION;
    try {
      const response = await fetch("https://chat.z.ai/", {
        headers: { Accept: "text/html", "User-Agent": ZAI_USER_AGENT },
        signal,
      });
      if (response.ok) version = parseZaiFrontendVersion(await response.text()) ?? version;
    } catch {
      // Fall back to the last verified version when homepage probing fails.
    }
    cachedFeVersion = { value: version, expiresAt: Date.now() + ZAI_FE_VERSION_CACHE_TTL_MS };
    return version;
  }

  private async createRemoteChat(input: {
    messages: Array<{ role: string; content: unknown }>;
    modelId: string;
    token: string;
    enableThinking: boolean;
    reasoningEffort: ZaiReasoningEffort;
    webSearchEnabled: boolean;
    signal?: AbortSignal;
  }): Promise<{ chatId: string; userMessageId: string } | { error: { status: number; message: string } }> {
    const { userMessageId, payload } = buildZaiNewChatBody(
      input.messages,
      input.modelId,
      input.enableThinking,
      input.reasoningEffort,
      input.webSearchEnabled
    );
    let response: Response;
    try {
      response = await fetch(ZAI_NEW_CHAT_URL, {
        method: "POST",
        headers: buildZaiHeaders(input.token, { accept: "application/json" }),
        body: JSON.stringify(payload),
        signal: input.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: { status: 502, message: `Z.ai chat creation failed: ${sanitizeErrorMessage(msg)}` } };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        error: { status: response.status, message: `Z.ai chat creation error: ${sanitizeErrorMessage(errorText)}` },
      };
    }
    const result = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const chatId = typeof result?.id === "string" ? result.id : "";
    if (!chatId) {
      return { error: { status: 502, message: "Z.ai chat creation returned no chat id" } };
    }
    return { chatId, userMessageId };
  }

  async execute({ model, body, stream, credentials, signal, log }: {
    model: string;
    body: Record<string, unknown>;
    stream: boolean;
    credentials: Credentials;
    signal?: AbortSignal;
    log?: Logger;
  }) {
    const resolved = resolveZaiRequest(body, credentials, model);
    if ("error" in resolved) {
      return { response: errorResponse(resolved.error.status, resolved.error.message), url: ZAI_CHAT_URL, headers: {}, transformedBody: body };
    }
    const { captchaVerifyParam, messages, modelId, prompt, thinkingConfig, token, userId, webSearchEnabled } = resolved.request;

    log?.info?.("ZAI-WEB", `Query to ${modelId}, msgs=${messages.length}`);

    const frontendVersion = await this.resolveFrontendVersion(signal);
    const createdChat = await this.createRemoteChat({
      messages,
      modelId,
      token,
      enableThinking: thinkingConfig.enabled,
      reasoningEffort: thinkingConfig.effort,
      webSearchEnabled,
      signal,
    });
    if ("error" in createdChat) {
      log?.warn?.("ZAI-WEB", createdChat.error.message);
      return { response: errorResponse(createdChat.error.status, createdChat.error.message), url: ZAI_NEW_CHAT_URL, headers: {}, transformedBody: body };
    }

    const timestamp = Date.now();
    const requestId = crypto.randomUUID();
    const signature = buildZaiSignature({ prompt, requestId, timestamp, userId });
    const completionUrl = buildZaiCompletionUrl({ requestId, timestamp, token, userId });
    const reqHeaders = buildZaiHeaders(token, { accept: "text/event-stream", frontendVersion, signature });
    const reqBody = buildZaiRequestBody({
      body,
      captchaVerifyParam,
      chatId: createdChat.chatId,
      messages,
      modelId,
      prompt,
      userMessageId: createdChat.userMessageId,
      enableThinking: thinkingConfig.enabled,
      reasoningEffort: thinkingConfig.effort,
      reasoningEffortSupported: thinkingConfig.effortSupported,
      webSearchEnabled,
    });

    let upstream: Response;
    try {
      upstream = await fetch(completionUrl, { method: "POST", headers: reqHeaders, body: JSON.stringify(reqBody), signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("ZAI-WEB", `Fetch failed: ${msg}`);
      return {
        response: errorResponse(502, `Z.ai connection failed: ${sanitizeErrorMessage(msg)}`),
        url: completionUrl,
        headers: reqHeaders,
        transformedBody: reqBody,
      };
    }

    if (!upstream.ok) {
      const status = upstream.status;
      const errorText = await upstream.text().catch(() => "");
      let errMsg = sanitizeErrorMessage(errorText) || `Z.ai returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Z.ai auth failed — token or captcha_verify_param may be expired. Re-paste both from chat.z.ai.";
      else if (status === 429) errMsg = "Z.ai rate limited. Wait a moment and retry.";
      log?.warn?.("ZAI-WEB", errMsg);
      return { response: errorResponse(status, errMsg), url: completionUrl, headers: reqHeaders, transformedBody: reqBody };
    }

    if (!upstream.body) {
      return { response: errorResponse(502, "Z.ai returned empty response body"), url: completionUrl, headers: reqHeaders, transformedBody: reqBody };
    }

    const id = `chatcmpl-zai-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const emitChunk = makeZaiChunkEmitter(id, created, modelId);

    if (stream) {
      const outStream = buildZaiStreamingBody(upstream.body, emitChunk, signal);
      return {
        response: new Response(outStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } }),
        url: completionUrl,
        headers: reqHeaders,
        transformedBody: reqBody,
      };
    }

    let answer: string;
    let reasoning: string;
    try {
      ({ answer, reasoning } = await collectZaiNonStreaming(upstream.body));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { response: errorResponse(502, `Z.ai stream failed: ${sanitizeErrorMessage(msg)}`), url: completionUrl, headers: reqHeaders, transformedBody: reqBody };
    }

    const message: Record<string, unknown> = { role: "assistant", content: answer };
    if (reasoning) message.reasoning_content = reasoning;
    const completion = {
      id, object: "chat.completion", created, model: modelId,
      choices: [{ index: 0, message, finish_reason: "stop" }],
    };
    return {
      response: new Response(JSON.stringify(completion), { headers: { "Content-Type": "application/json" } }),
      url: completionUrl,
      headers: reqHeaders,
      transformedBody: reqBody,
    };
  }
}

export default ZaiWebExecutor;
