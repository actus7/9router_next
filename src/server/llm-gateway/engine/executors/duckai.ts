/**
 * Duck.ai Executor — full VQD challenge → SSE OpenAI bridge.
 *
 * Flow:
 * 1. Warm: GET /duckchat/v1/auth/token → accumulate cookies
 * 2. GET /duckchat/v1/status with x-vqd-accept: 1 → x-vqd-hash-1 header (challenge base64)
 * 3. Solve challenge (3 layers: jsdom deobfuscation → jsdom retry → Puppeteer fallback)
 * 4. Hash payload: SHA-256 base64 of each client_hash → JSON → base64
 * 5. Chat: POST /duckchat/v1/chat with VQD headers + cookies + durableStream
 * 6. SSE conversion: Duck.ai SSE → OpenAI chat.completion.chunk
 * 7. Retry: max 5 attempts; ERR_BN_LIMIT → backoff; 418/challenge → refresh VQD; empty → retry
 */

import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base";
import type { ExecuteArgs } from "./base";
import { PROVIDERS } from "../config/providers";
import {
  CHAT_URL,
  DUCKAI_CHAT_MAX_ATTEMPTS,
  type DdgMessage,
  type DuckAiReasoningEffort,
  type DuckAiVqdData,
  buildDuckAiErrorResponse,
  buildDuckAiTemporaryErrorResponse,
  getVqdData,
  isRetryableDuckAiHttpFailure,
  isRetryableDuckAiThrownError,
  logAndDecideDuckAiRetry,
  logDuckAi,
  mergeCookies,
  sleep,
} from "./duckaiRuntime";
import {
  buildDuckAiDurableStreamPayload,
  getReasoningEffort,
  sendDuckAiChatRequest,
  toDdgMessages,
} from "./duckaiRequest";
import { primeDuckAiStream } from "./duckaiStream";

type DuckAiAttemptResult =
  | { action: "success"; response: Response }
  | { action: "retry"; delayMs: number }
  | { action: "error"; response: Response };

async function executeDuckAiAttempt(
  attempt: number,
  ddgMessages: DdgMessage[],
  model: string,
  reasoningEffort: DuckAiReasoningEffort | undefined,
  state: { cookieJar: string; activeVqdData: DuckAiVqdData | null },
  reusedVqd: boolean,
  signal: AbortSignal | undefined,
  body: Record<string, unknown>,
  cid: string,
  created: number
): Promise<DuckAiAttemptResult> {
  const durableStream = await buildDuckAiDurableStreamPayload();

  if (!state.activeVqdData) {
    state.activeVqdData = await getVqdData(state.cookieJar);
    state.cookieJar = mergeCookies(state.cookieJar, state.activeVqdData!.cookies);
  }

  const { cookies, response: chatResponse } = await sendDuckAiChatRequest({
    cookies: state.cookieJar,
    durableStream,
    messages: ddgMessages,
    modelId: model,
    reasoningEffort,
    vqdData: state.activeVqdData!,
    signal,
  });
  state.cookieJar = mergeCookies(state.cookieJar, cookies);

  // Handle HTTP errors
  if (!chatResponse.ok) {
    const errorText = await chatResponse.text().catch(() => "");
    const classification = isRetryableDuckAiHttpFailure(chatResponse.status, errorText);

    if (classification.retryable && classification.retryClass) {
      const decision = logAndDecideDuckAiRetry(
        attempt, classification.retryClass, "chat_http",
        { ...classification.info, status: chatResponse.status },
        { activeVqdData: state.activeVqdData, reusedVqd }
      );
      if (decision.refreshVqd) state.activeVqdData = null;
      if (decision.shouldRetry) return { action: "retry", delayMs: decision.delayMs };
      return { action: "error", response: buildDuckAiTemporaryErrorResponse(body).response };
    }

    return {
      action: "error",
      response: buildDuckAiErrorResponse(chatResponse.status, {
        message: `Duck.ai returned HTTP ${chatResponse.status}: ${errorText}`,
        type: "upstream_error",
        code: `HTTP_${chatResponse.status}`,
      }),
    };
  }

  // Prime the stream (detect early errors before committing to SSE)
  const primed = await primeDuckAiStream(chatResponse, model, cid, created, signal);

  if ("retryableError" in primed) {
    const decision = logAndDecideDuckAiRetry(
      attempt, primed.retryableError.info.retryClass, "chat_stream",
      primed.retryableError.info, { activeVqdData: state.activeVqdData, reusedVqd }
    );
    if (decision.refreshVqd) state.activeVqdData = null;
    if (decision.shouldRetry) return { action: "retry", delayMs: decision.delayMs };
    return { action: "error", response: buildDuckAiTemporaryErrorResponse(body).response };
  }

  if ("errorResponse" in primed) {
    return { action: "error", response: primed.errorResponse };
  }

  return { action: "success", response: primed.response };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class DuckAiExecutor extends BaseExecutor {
  constructor() {
    super("duckai", PROVIDERS["duckai"] || {});
  }

  async execute({ model, body, stream, credentials: _credentials, signal, log }: ExecuteArgs) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { response: buildDuckAiErrorResponse(400, { message: "Missing or empty messages array", type: "invalid_request" }), url: CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const ddgMessages = toDdgMessages(messages);
    if (ddgMessages.length === 0) {
      return { response: buildDuckAiErrorResponse(400, { message: "Empty query after processing", type: "invalid_request" }), url: CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const reasoningEffort = getReasoningEffort(model);
    const cid = `chatcmpl-duckai-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    log?.info?.("DUCKAI", `Query to ${model}, ${ddgMessages.length} messages, stream=${stream}`);

    const state = { cookieJar: "", activeVqdData: null as DuckAiVqdData | null };

    for (let attempt = 1; attempt <= DUCKAI_CHAT_MAX_ATTEMPTS; attempt++) {
      try {
        const reusedVqd = !!state.activeVqdData;
        const result = await executeDuckAiAttempt(
          attempt, ddgMessages, model, reasoningEffort, state, reusedVqd, signal, body, cid, created
        );

        if (result.action === "retry") {
          await sleep(result.delayMs);
          continue;
        }

        if (result.action === "success" && (attempt > 1 || state.activeVqdData?.browserFallbackUsed || (state.activeVqdData?.jsdomAttempts ?? 0) > 1)) {
          logDuckAi("chat", "log", {
            attempt,
            browserFallbackUsed: state.activeVqdData?.browserFallbackUsed,
            finalOutcome: "success",
            jsdomAttempts: state.activeVqdData?.jsdomAttempts,
            phase: "chat_http",
            reusedVqd,
          });
        }

        return { response: result.response, url: CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
      } catch (error) {
        const retryable = isRetryableDuckAiThrownError(error);
        if (retryable) {
          const decision = logAndDecideDuckAiRetry(
            attempt, retryable.info.retryClass, retryable.info.phase, retryable.info,
            { forceRefreshVqd: retryable.info.phase === "vqd" }
          );
          if (decision.refreshVqd) state.activeVqdData = null;
          if (decision.shouldRetry) { await sleep(decision.delayMs); continue; }
          return buildDuckAiTemporaryErrorResponse(body);
        }

        const errMsg = error instanceof Error ? error.message : String(error);
        log?.error?.("DUCKAI", `Non-retryable error: ${errMsg}`);
        return {
          response: buildDuckAiErrorResponse(502, { message: `Duck.ai internal error: ${errMsg}`, type: "upstream_error" }),
          url: CHAT_URL,
          headers: {} as Record<string, string>,
          transformedBody: body,
        };
      }
    }

    return buildDuckAiTemporaryErrorResponse(body);
  }
}

export default DuckAiExecutor;
