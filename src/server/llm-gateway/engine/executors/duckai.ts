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

import { createHash, randomUUID, webcrypto } from "node:crypto";
import { BaseExecutor } from "./base";
import type { ExecuteArgs } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import {
  solveVqdChallengeMultiLayer,
  getDuckAiChallengeRuntime,
  type VqdChallengeResult,
  type DuckAiChallengeRuntime,
} from "./duckai-challenge";
import type { Credentials, Logger } from "../services/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_URL = PROVIDERS["duckai"]?.baseUrl as string || "https://duck.ai/duckchat/v1/chat";
const AUTH_TOKEN_URL = "https://duck.ai/duckchat/v1/auth/token";
const STATUS_URL = "https://duck.ai/duckchat/v1/status";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const DUCKAI_TEMPORARY_ERROR_MESSAGE =
  "Duck.ai is temporarily unavailable. Please try again in a few moments.";

const DUCKAI_CHAT_MAX_ATTEMPTS = readNumberEnv("DUCKAI_CHAT_MAX_ATTEMPTS", 5);
const DUCKAI_CHAT_RETRY_BASE_DELAY_MS = readNumberEnv("DUCKAI_CHAT_RETRY_BASE_DELAY_MS", 750);
const DUCKAI_CHAT_RETRY_MAX_DELAY_MS = readNumberEnv("DUCKAI_CHAT_RETRY_MAX_DELAY_MS", 5000);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DdgMessage = { role: "user" | "assistant"; content: string };
type DuckAiReasoningEffort = "minimal" | "low";
type DuckAiRetryClass = "bn_limit" | "challenge" | "empty_stream" | "network" | "timeout";
type DuckAiRetryPhase = "chat_http" | "chat_stream_prelude" | "vqd";

type DuckAiVqdData = {
  browserFallbackUsed: boolean;
  cookies: string;
  hashPayload: string;
  jsdomAttempts: number;
};

type DuckAiSseEvent =
  | { kind: "content"; content: string }
  | {
      kind: "error";
      message: string;
      overrideCode?: string;
      retryClass?: DuckAiRetryClass;
      type?: string;
    };

type DuckAiUpstreamErrorInfo = {
  overrideCode?: string;
  status?: number;
  type?: string;
};

class DuckAiRetryableError extends Error {
  constructor(
    message: string,
    readonly info: {
      overrideCode?: string;
      phase: DuckAiRetryPhase;
      retryClass: DuckAiRetryClass;
      status?: number;
      type?: string;
    }
  ) {
    super(message);
    this.name = "DuckAiRetryableError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SHA-256 of a string, returned as base64 (sync, using node:crypto) */
function sha256Base64(text: string): string {
  return createHash("sha256").update(text).digest("base64");
}

function isJson(str: string): boolean {
  try {
    return str !== null && JSON.parse(str) !== null;
  } catch {
    return false;
  }
}

function mergeCookies(...cookieHeaders: Array<string | undefined>): string {
  const cookieMap = new Map<string, string>();
  for (const header of cookieHeaders) {
    if (!header) continue;
    for (const part of header.split(/;\s*/)) {
      const [name, ...valueParts] = part.split("=");
      if (!name || valueParts.length === 0) continue;
      cookieMap.set(name, valueParts.join("="));
    }
  }
  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function getCookieHeaderValue(headers: Headers): string | undefined {
  const raw = headers.get("set-cookie");
  if (!raw) return undefined;
  // Extract cookie name=value pairs from set-cookie headers
  return raw
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function appendResponseCookies(existingCookies: string, headers: Headers): string {
  return mergeCookies(existingCookies, getCookieHeaderValue(headers));
}

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

function getDuckAiRetryDelay(attempt: number, retryClass: DuckAiRetryClass): number {
  const isBnLimit = retryClass === "bn_limit";
  const baseDelayMs = isBnLimit
    ? Math.max(DUCKAI_CHAT_RETRY_BASE_DELAY_MS * 4, 3000)
    : DUCKAI_CHAT_RETRY_BASE_DELAY_MS;
  const maxDelayMs = isBnLimit
    ? Math.max(DUCKAI_CHAT_RETRY_MAX_DELAY_MS * 3, baseDelayMs)
    : DUCKAI_CHAT_RETRY_MAX_DELAY_MS;
  const computed = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(computed, maxDelayMs);
}

function shouldRefreshDuckAiVqd(retryClass: DuckAiRetryClass): boolean {
  return retryClass === "challenge";
}

function logDuckAi(
  scope: "challenge" | "chat",
  level: "error" | "log" | "warn",
  payload: Record<string, unknown>
): void {
  console[level](`[Duck.ai][${scope}] ${JSON.stringify(payload)}`);
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function parseDuckAiUpstreamError(raw: string, status?: number): DuckAiUpstreamErrorInfo {
  if (!raw.trim()) return { status };
  try {
    const parsed = JSON.parse(raw) as {
      overrideCode?: unknown;
      status?: unknown;
      type?: unknown;
    };
    return {
      overrideCode: typeof parsed.overrideCode === "string" ? parsed.overrideCode : undefined,
      status:
        typeof parsed.status === "number"
          ? parsed.status
          : typeof status === "number"
            ? status
            : undefined,
      type: typeof parsed.type === "string" ? parsed.type : undefined,
    };
  } catch {
    return {
      status,
      type: raw.includes("ERR_BN_LIMIT")
        ? "ERR_BN_LIMIT"
        : raw.includes("ERR_CHALLENGE")
          ? "ERR_CHALLENGE"
          : undefined,
    };
  }
}

function isRetryableDuckAiHttpFailure(
  status: number,
  raw: string
): {
  info: DuckAiUpstreamErrorInfo;
  retryClass?: DuckAiRetryClass;
  retryable: boolean;
} {
  const info = parseDuckAiUpstreamError(raw, status);
  const isBnLimit = info.type === "ERR_BN_LIMIT" || raw.includes("ERR_BN_LIMIT");
  const isChallenge =
    !isBnLimit &&
    (status === 418 || info.type === "ERR_CHALLENGE" || raw.includes("ERR_CHALLENGE"));

  return {
    info,
    retryClass: isBnLimit ? "bn_limit" : isChallenge ? "challenge" : undefined,
    retryable: isBnLimit || isChallenge,
  };
}

function isRetryableDuckAiThrownError(error: unknown): DuckAiRetryableError | null {
  if (error instanceof DuckAiRetryableError) return error;

  if (error instanceof DOMException && error.name === "AbortError") {
    return new DuckAiRetryableError("Duck.ai request timed out before producing output.", {
      phase: "chat_http",
      retryClass: "timeout",
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ERR_BN_LIMIT")) {
    return new DuckAiRetryableError(message, {
      overrideCode: parseDuckAiUpstreamError(message).overrideCode,
      phase: "chat_http",
      retryClass: "bn_limit",
      status: 418,
      type: "ERR_BN_LIMIT",
    });
  }

  if (
    message.includes("VQD challenge failed after") ||
    message.includes("Failed to load external module jsdom") ||
    message.includes("ERR_REQUIRE_ESM")
  ) {
    return new DuckAiRetryableError(message, {
      phase: "vqd",
      retryClass: "challenge",
    });
  }

  if (message.toLowerCase().includes("fetch failed")) {
    return new DuckAiRetryableError(message, {
      phase: "chat_http",
      retryClass: "network",
    });
  }

  return null;
}

// ---------------------------------------------------------------------------
// VQD challenge flow
// ---------------------------------------------------------------------------

const STATUS_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-store",
  DNT: "1",
  Referer: "https://duck.ai/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": UA,
  "x-vqd-accept": "1",
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("fetch timeout")), timeoutMs);
  try {
    const mergedInit: RequestInit = { ...init };
    if (init.signal) {
      mergedInit.signal = AbortSignal.any([init.signal, ctrl.signal]);
    } else {
      mergedInit.signal = ctrl.signal;
    }
    return await fetch(url, mergedInit);
  } finally {
    clearTimeout(timer);
  }
}

async function warmDuckAiAuthToken(existingCookies = ""): Promise<{ cookies: string }> {
  const response = await fetchWithTimeout(
    AUTH_TOKEN_URL,
    {
      method: "GET",
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(existingCookies ? { Cookie: existingCookies } : {}),
        DNT: "1",
        Referer: "https://duck.ai/",
        "User-Agent": UA,
      },
    },
    10000
  );

  if (!response.ok) {
    throw new Error(`Failed to warm Duck.ai auth token: ${response.status}`);
  }

  return { cookies: appendResponseCookies(existingCookies, response.headers) };
}

/**
 * Build the base64 hash payload from a challenge result.
 */
function buildHashPayload(challengeResult: VqdChallengeResult): string {
  const hashedClientHashes = challengeResult.client_hashes.map((c) => sha256Base64(c));
  const payload = { ...challengeResult, client_hashes: hashedClientHashes };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Fetch a fresh VQD challenge hash from the status endpoint.
 */
async function fetchChallengeHash(seedCookies = ""): Promise<{
  challengeHash: string;
  cookies: string;
}> {
  const warmed = await warmDuckAiAuthToken(seedCookies);

  const response = await fetchWithTimeout(
    STATUS_URL,
    {
      method: "GET",
      headers: {
        ...STATUS_HEADERS,
        ...(warmed.cookies ? { Cookie: warmed.cookies } : {}),
      },
    },
    15000
  );
  if (!response.ok) {
    throw new Error(`Failed to get VQD status: ${response.status}`);
  }

  const rawHash = response.headers.get("x-vqd-hash-1") || "";
  if (!rawHash) {
    throw new Error("No x-vqd-hash-1 header in status response");
  }
  return {
    challengeHash: rawHash,
    cookies: appendResponseCookies(warmed.cookies, response.headers),
  };
}

/**
 * Get the solved hash payload — full VQD flow.
 */
async function getVqdData(seedCookies = ""): Promise<DuckAiVqdData> {
  let cookies = seedCookies;
  const challengeRuntime = getDuckAiChallengeRuntime();

  if (challengeRuntime === "off") {
    throw new Error(
      "Duck.ai VQD challenge runtime is disabled. Set DUCKAI_BROWSER_WS_ENDPOINT " +
        "or DUCKAI_CHALLENGE_RUNTIME=browser to keep Duck.ai enabled safely."
    );
  }

  const challenge = await fetchChallengeHash(cookies);
  cookies = challenge.cookies;

  const { result, browserFallbackUsed, jsdomAttempts } = await solveVqdChallengeMultiLayer(
    challenge.challengeHash,
    challengeRuntime,
    cookies
  );

  return {
    browserFallbackUsed,
    cookies,
    hashPayload: buildHashPayload(result),
    jsdomAttempts,
  };
}

// ---------------------------------------------------------------------------
// Duck.ai SSE parsing
// ---------------------------------------------------------------------------

function createDuckAiStreamEvent(rawChunk: string): DuckAiSseEvent | null {
  const json = rawChunk.replace(/^data:\s*/, "");
  if (!isJson(json)) return null;

  const parsed = JSON.parse(json) as {
    action?: string;
    content?: string;
    message?: string;
    overrideCode?: string;
    role?: string;
    type?: string;
  };

  if (parsed.action === "error") {
    const message = parsed.type ?? parsed.message ?? "Duck.ai stream returned an error event";
    const retryClass =
      parsed.type === "ERR_BN_LIMIT" || message.includes("ERR_BN_LIMIT")
        ? "bn_limit"
        : parsed.type === "ERR_CHALLENGE" || message.includes("ERR_CHALLENGE")
          ? "challenge"
          : undefined;
    return {
      kind: "error",
      message,
      overrideCode: parsed.overrideCode,
      retryClass,
      type: parsed.type,
    };
  }

  const content =
    typeof parsed.message === "string"
      ? parsed.message
      : parsed.role === "assistant" && typeof parsed.content === "string"
        ? parsed.content
        : "";

  return content ? { content, kind: "content" } : null;
}

function extractDuckAiSseChunks(
  buffer: string,
  flush = false
): { chunks: string[]; rest: string } {
  if (flush) {
    const finalChunk = buffer.trim();
    return { chunks: finalChunk ? [finalChunk] : [], rest: "" };
  }

  const parts = buffer.split("\n\n");
  return {
    chunks: parts.slice(0, -1).filter((part) => part.startsWith("data: ")),
    rest: parts.at(-1) ?? "",
  };
}

// ---------------------------------------------------------------------------
// Chat request building
// ---------------------------------------------------------------------------

function buildDuckAiSignalsHeader(): string {
  const start = Date.now();
  const end = start + 1;
  return Buffer.from(JSON.stringify({ end, events: [], start })).toString("base64");
}

function buildDuckAiToolChoice() {
  return {
    LocalSearch: false,
    NewsSearch: false,
    VideosSearch: false,
    WeatherForecast: false,
  };
}

async function buildDuckAiDurableStreamPayload(): Promise<{
  conversationId: string;
  messageId: string;
  publicKey: JsonWebKey;
}> {
  const keyPair = (await webcrypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  )) as CryptoKeyPair;

  const publicKey = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);

  return {
    conversationId: randomUUID(),
    messageId: randomUUID(),
    publicKey: {
      ...publicKey,
      alg: "RSA-OAEP-256",
      ext: true,
      key_ops: ["encrypt"],
      use: "enc",
    },
  };
}

function toDdgMessages(
  messages: Record<string, unknown>[]
): DdgMessage[] {
  const result: DdgMessage[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    let content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = (m.content as Record<string, unknown>[])
        .filter((c) => c.type === "text")
        .map((c) => String((c as Record<string, unknown>).text || ""))
        .join(" ");
    }
    if (!content.trim()) continue;
    result.push({ role, content });
  }
  return result;
}

// Model IDs known to support reasoning effort
const REASONING_EFFORT_MODELS: Record<string, DuckAiReasoningEffort> = {
  "gpt-5-mini": "minimal",
};

function getReasoningEffort(modelId: string): DuckAiReasoningEffort | undefined {
  return REASONING_EFFORT_MODELS[modelId];
}

async function sendDuckAiChatRequest(input: {
  cookies: string;
  durableStream: Awaited<ReturnType<typeof buildDuckAiDurableStreamPayload>>;
  messages: DdgMessage[];
  modelId: string;
  reasoningEffort?: DuckAiReasoningEffort;
  vqdData: DuckAiVqdData;
  signal?: AbortSignal;
}): Promise<{ cookies: string; response: Response }> {
  const chatHeaders: Record<string, string> = {
    ...STATUS_HEADERS,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    ...(input.cookies ? { Cookie: input.cookies } : {}),
    Origin: "https://duck.ai",
    "x-fe-signals": buildDuckAiSignalsHeader(),
    "x-vqd-hash-1": input.vqdData.hashPayload,
  };
  const requestBody: Record<string, unknown> = {
    model: input.modelId,
    messages: input.messages,
    canUseTools: true,
    canUseApproxLocation: null,
    durableStream: input.durableStream,
    metadata: {
      toolChoice: buildDuckAiToolChoice(),
    },
  };

  if (input.reasoningEffort) {
    requestBody.reasoningEffort = input.reasoningEffort;
  }

  const response = await fetchWithTimeout(
    CHAT_URL,
    {
      method: "POST",
      headers: chatHeaders,
      body: JSON.stringify(requestBody),
      signal: input.signal,
    },
    60000
  );

  return {
    cookies: appendResponseCookies(input.cookies, response.headers),
    response,
  };
}

// ---------------------------------------------------------------------------
// SSE stream conversion: Duck.ai → OpenAI chat.completion.chunk
// ---------------------------------------------------------------------------

function buildDuckAiStreamingResponse(
  chatBody: ReadableStream<Uint8Array>,
  model: string,
  cid: string,
  created: number,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      try {
        // Emit role chunk
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant" },
                  finish_reason: null,
                  logprobs: null,
                },
              ],
            })
          )
        );

        const reader = chatBody.getReader();
        let buffer = "";
        let hasContent = false;

        try {
          while (true) {
            if (signal?.aborted) break;

            const { done, value } = await reader.read();
            if (done) {
              // Flush remaining buffer
              const finalChunks = extractDuckAiSseChunks(buffer, true).chunks;
              for (const rawChunk of finalChunks) {
                const event = createDuckAiStreamEvent(rawChunk);
                if (!event) continue;
                if (event.kind === "error") {
                  controller.enqueue(
                    encoder.encode(
                      sseChunk({
                        id: cid,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        system_fingerprint: null,
                        choices: [
                          {
                            index: 0,
                            delta: { content: `[Error: ${event.message}]` },
                            finish_reason: null,
                            logprobs: null,
                          },
                        ],
                      })
                    )
                  );
                  hasContent = true;
                  break;
                }
                if (event.content) {
                  hasContent = true;
                  controller.enqueue(
                    encoder.encode(
                      sseChunk({
                        id: cid,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        system_fingerprint: null,
                        choices: [
                          {
                            index: 0,
                            delta: { content: event.content },
                            finish_reason: null,
                            logprobs: null,
                          },
                        ],
                      })
                    )
                  );
                }
              }
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const extracted = extractDuckAiSseChunks(buffer);
            buffer = extracted.rest;

            for (const rawChunk of extracted.chunks) {
              const event = createDuckAiStreamEvent(rawChunk);
              if (!event) continue;

              if (event.kind === "error") {
                controller.enqueue(
                  encoder.encode(
                    sseChunk({
                      id: cid,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      system_fingerprint: null,
                      choices: [
                        {
                          index: 0,
                          delta: { content: `[Error: ${event.message}]` },
                          finish_reason: null,
                          logprobs: null,
                        },
                      ],
                    })
                  )
                );
                hasContent = true;
                // Don't break — let the stream finish naturally
                continue;
              }

              if (event.content) {
                hasContent = true;
                controller.enqueue(
                  encoder.encode(
                    sseChunk({
                      id: cid,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      system_fingerprint: null,
                      choices: [
                        {
                          index: 0,
                          delta: { content: event.content },
                          finish_reason: null,
                          logprobs: null,
                        },
                      ],
                    })
                  )
                );
              }
            }
          }
        } finally {
          try { reader.releaseLock(); } catch { /* ignore */ }
        }

        // Emit finish chunk
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                  logprobs: null,
                },
              ],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: { content: `[Stream error: ${errorMsg}]` },
                  finish_reason: "stop",
                  logprobs: null,
                },
              ],
            })
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        controller.close();
      }
    },
  });
}

async function buildDuckAiNonStreamingResponse(
  chatBody: ReadableStream<Uint8Array>,
  model: string,
  cid: string,
  created: number,
  signal?: AbortSignal
): Promise<Response> {
  const decoder = new TextDecoder();
  let fullContent = "";

  const reader = chatBody.getReader();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) {
        const finalChunks = extractDuckAiSseChunks(buffer, true).chunks;
        for (const rawChunk of finalChunks) {
          const event = createDuckAiStreamEvent(rawChunk);
          if (!event) continue;
          if (event.kind === "error") {
            return new Response(
              JSON.stringify({
                error: {
                  message: event.message,
                  type: "upstream_error",
                  code: "DUCKAI_ERROR",
                },
              }),
              { status: 502, headers: { "Content-Type": "application/json" } }
            );
          }
          if (event.content) fullContent += event.content;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const extracted = extractDuckAiSseChunks(buffer);
      buffer = extracted.rest;

      for (const rawChunk of extracted.chunks) {
        const event = createDuckAiStreamEvent(rawChunk);
        if (!event) continue;
        if (event.kind === "error") {
          return new Response(
            JSON.stringify({
              error: {
                message: event.message,
                type: "upstream_error",
                code: "DUCKAI_ERROR",
              },
            }),
            { status: 502, headers: { "Content-Type": "application/json" } }
          );
        }
        if (event.content) fullContent += event.content;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(
    JSON.stringify({
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: fullContent },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ---------------------------------------------------------------------------
// Stream priming: detect early errors before committing to SSE
// ---------------------------------------------------------------------------

type PrimedDuckAiStreamResult =
  | { response: Response }
  | { retryableError: DuckAiRetryableError }
  | { errorResponse: Response };

function classifyDuckAiStreamError(
  event: DuckAiSseEvent & { kind: "error" }
): PrimedDuckAiStreamResult {
  if (event.retryClass) {
    return {
      retryableError: new DuckAiRetryableError(event.message, {
        overrideCode: event.overrideCode,
        phase: "chat_stream_prelude",
        retryClass: event.retryClass,
        type: event.type,
      }),
    };
  }

  return {
    errorResponse: new Response(
      JSON.stringify({
        error: {
          message: event.message,
          type: "upstream_error",
          code: "DUCKAI_STREAM_ERROR",
          overrideCode: event.overrideCode,
          upstreamType: event.type,
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    ),
  };
}

async function primeDuckAiStream(
  chatResponse: Response,
  model: string,
  cid: string,
  created: number,
  signal?: AbortSignal
): Promise<PrimedDuckAiStreamResult> {
  if (!chatResponse.body) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: { message: "Duck.ai returned no response body", type: "upstream_error" },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const reader = chatResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      const finalChunks = extractDuckAiSseChunks(buffer, true).chunks;
      for (const rawChunk of finalChunks) {
        const event = createDuckAiStreamEvent(rawChunk);
        if (!event) continue;

        if (event.kind === "error") {
          await reader.cancel().catch(() => {});
          return classifyDuckAiStreamError(event);
        }

        // Got content — build the streaming response from here
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();

        // Pump remaining chunks + continue reading
        void (async () => {
          try {
            // Emit role
            await writer.write(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    { index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null },
                  ],
                })
              )
            );

            // Emit the content we already parsed
            await writer.write(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content: event.content },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
              )
            );

            // Emit remaining final chunks
            for (const rc of finalChunks.slice(finalChunks.indexOf(rawChunk) + 1)) {
              const ev = createDuckAiStreamEvent(rc);
              if (!ev || ev.kind === "error") continue;
              if (ev.content) {
                await writer.write(
                  encoder.encode(
                    sseChunk({
                      id: cid,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      system_fingerprint: null,
                      choices: [
                        {
                          index: 0,
                          delta: { content: ev.content },
                          finish_reason: null,
                          logprobs: null,
                        },
                      ],
                    })
                  )
                );
              }
            }

            // Done
            await writer.write(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
                })
              )
            );
            await writer.write(encoder.encode(SSE_DONE));
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            await writer
              .write(
                encoder.encode(
                  sseChunk({
                    id: cid,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    system_fingerprint: null,
                    choices: [
                      {
                        index: 0,
                        delta: { content: `[Stream error: ${errorMsg}]` },
                        finish_reason: "stop",
                        logprobs: null,
                      },
                    ],
                  })
                )
              )
              .catch(() => {});
            await writer.write(encoder.encode(SSE_DONE)).catch(() => {});
          } finally {
            await writer.close().catch(() => {});
          }
        })();

        return {
          response: new Response(readable, {
            status: 200,
            headers: { ...SSE_HEADERS_NO_BUFFER },
          }),
        };
      }

      // Stream ended with no content and no error
      await reader.cancel().catch(() => {});
      return {
        retryableError: new DuckAiRetryableError(
          "Duck.ai stream ended before producing output.",
          {
            phase: "chat_stream_prelude",
            retryClass: "empty_stream",
          }
        ),
      };
    }

    buffer += decoder.decode(value, { stream: true });
    const extracted = extractDuckAiSseChunks(buffer);
    buffer = extracted.rest;

    for (let index = 0; index < extracted.chunks.length; index++) {
      const rawChunk = extracted.chunks[index];
      const event = createDuckAiStreamEvent(rawChunk);
      if (!event) continue;

      if (event.kind === "error") {
        await reader.cancel().catch(() => {});
        return classifyDuckAiStreamError(event);
      }

      // Got content — build streaming response from remaining chunks
      const encoder = new TextEncoder();
      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();

      void (async () => {
        try {
          // Emit role
          await writer.write(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  { index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null },
                ],
              })
            )
          );

          // Emit first content
          await writer.write(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  {
                    index: 0,
                    delta: { content: event.content },
                    finish_reason: null,
                    logprobs: null,
                  },
                ],
              })
            )
          );

          // Emit remaining chunks from the current batch
          for (const rc of extracted.chunks.slice(index + 1)) {
            const ev = createDuckAiStreamEvent(rc);
            if (!ev || ev.kind === "error") continue;
            if (ev.content) {
              await writer.write(
                encoder.encode(
                  sseChunk({
                    id: cid,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    system_fingerprint: null,
                    choices: [
                      {
                        index: 0,
                        delta: { content: ev.content },
                        finish_reason: null,
                        logprobs: null,
                      },
                    ],
                  })
                )
              );
            }
          }

          // Continue reading from upstream
          const upstreamDecoder = new TextDecoder();
          let upstreamBuffer = buffer;
          while (true) {
            if (signal?.aborted) break;
            const { done: d, value: v } = await reader.read();
            if (d) {
              const fc = extractDuckAiSseChunks(upstreamBuffer, true).chunks;
              for (const rc of fc) {
                const ev = createDuckAiStreamEvent(rc);
                if (!ev || ev.kind === "error") continue;
                if (ev.content) {
                  await writer.write(
                    encoder.encode(
                      sseChunk({
                        id: cid,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        system_fingerprint: null,
                        choices: [
                          {
                            index: 0,
                            delta: { content: ev.content },
                            finish_reason: null,
                            logprobs: null,
                          },
                        ],
                      })
                    )
                  );
                }
              }
              break;
            }
            upstreamBuffer += upstreamDecoder.decode(v, { stream: true });
            const ext = extractDuckAiSseChunks(upstreamBuffer);
            upstreamBuffer = ext.rest;
            for (const rc of ext.chunks) {
              const ev = createDuckAiStreamEvent(rc);
              if (!ev || ev.kind === "error") continue;
              if (ev.content) {
                await writer.write(
                  encoder.encode(
                    sseChunk({
                      id: cid,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      system_fingerprint: null,
                      choices: [
                        {
                          index: 0,
                          delta: { content: ev.content },
                          finish_reason: null,
                          logprobs: null,
                        },
                      ],
                    })
                  )
                );
              }
            }
          }

          // Emit finish
          await writer.write(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
              })
            )
          );
          await writer.write(encoder.encode(SSE_DONE));
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await writer
            .write(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content: `[Stream error: ${errorMsg}]` },
                      finish_reason: "stop",
                      logprobs: null,
                    },
                  ],
                })
              )
            )
            .catch(() => {});
          await writer.write(encoder.encode(SSE_DONE)).catch(() => {});
        } finally {
          await writer.close().catch(() => {});
        }
      })();

      return {
        response: new Response(readable, {
          status: 200,
          headers: { ...SSE_HEADERS_NO_BUFFER },
        }),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class DuckAiExecutor extends BaseExecutor {
  constructor() {
    super("duckai", PROVIDERS["duckai"] || {});
  }

  async execute({ model, body, stream, credentials, signal, log }: ExecuteArgs) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(
        JSON.stringify({
          error: { message: "Missing or empty messages array", type: "invalid_request" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
      return { response: errResp, url: CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const ddgMessages = toDdgMessages(messages);
    if (ddgMessages.length === 0) {
      const errResp = new Response(
        JSON.stringify({
          error: { message: "Empty query after processing", type: "invalid_request" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
      return { response: errResp, url: CHAT_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const reasoningEffort = getReasoningEffort(model);
    const cid = `chatcmpl-duckai-${randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    log?.info?.("DUCKAI", `Query to ${model}, ${ddgMessages.length} messages, stream=${stream}`);

    let cookieJar = "";
    let activeVqdData: DuckAiVqdData | null = null;

    for (let attempt = 1; attempt <= DUCKAI_CHAT_MAX_ATTEMPTS; attempt++) {
      try {
        // Build durable stream payload (keypair generation)
        const durableStream = await buildDuckAiDurableStreamPayload();
        let reusedVqd = false;

        // Get VQD data (fresh or reuse)
        if (activeVqdData) {
          reusedVqd = true;
        } else {
          activeVqdData = await getVqdData(cookieJar);
          cookieJar = mergeCookies(cookieJar, activeVqdData.cookies);
        }

        // Send chat request
        const { cookies, response: chatResponse } = await sendDuckAiChatRequest({
          cookies: cookieJar,
          durableStream,
          messages: ddgMessages,
          modelId: model,
          reasoningEffort,
          vqdData: activeVqdData,
          signal,
        });
        cookieJar = mergeCookies(cookieJar, cookies);

        // Handle HTTP errors
        if (!chatResponse.ok) {
          const errorText = await chatResponse.text().catch(() => "");
          const classification = isRetryableDuckAiHttpFailure(chatResponse.status, errorText);

          if (classification.retryable && classification.retryClass) {
            const delayMs = getDuckAiRetryDelay(attempt, classification.retryClass);
            const finalOutcome = attempt < DUCKAI_CHAT_MAX_ATTEMPTS ? "retrying" : "exhausted";
            logDuckAi("chat", finalOutcome === "retrying" ? "warn" : "error", {
              attempt,
              browserFallbackUsed: activeVqdData?.browserFallbackUsed,
              delayMs: finalOutcome === "retrying" ? delayMs : undefined,
              finalOutcome,
              jsdomAttempts: activeVqdData?.jsdomAttempts,
              phase: "chat_http",
              retryClass: classification.retryClass,
              reusedVqd,
              status: chatResponse.status,
              type: classification.info.type,
              overrideCode: classification.info.overrideCode,
            });

            if (shouldRefreshDuckAiVqd(classification.retryClass)) {
              activeVqdData = null;
            }

            if (attempt < DUCKAI_CHAT_MAX_ATTEMPTS) {
              await sleep(delayMs);
              continue;
            }

            return {
              response: new Response(
                JSON.stringify({ error: { message: DUCKAI_TEMPORARY_ERROR_MESSAGE, type: "upstream_error" } }),
                { status: 503, headers: { "Content-Type": "application/json" } }
              ),
              url: CHAT_URL,
              headers: {} as Record<string, string>,
              transformedBody: body,
            };
          }

          return {
            response: new Response(
              JSON.stringify({
                error: {
                  message: `Duck.ai returned HTTP ${chatResponse.status}: ${errorText}`,
                  type: "upstream_error",
                  code: `HTTP_${chatResponse.status}`,
                },
              }),
              { status: chatResponse.status, headers: { "Content-Type": "application/json" } }
            ),
            url: CHAT_URL,
            headers: {} as Record<string, string>,
            transformedBody: body,
          };
        }

        // Prime the stream (detect early errors before committing to SSE)
        const primed = await primeDuckAiStream(chatResponse, model, cid, created, signal);

        if ("retryableError" in primed) {
          const delayMs = getDuckAiRetryDelay(attempt, primed.retryableError.info.retryClass);
          const finalOutcome = attempt < DUCKAI_CHAT_MAX_ATTEMPTS ? "retrying" : "exhausted";
          logDuckAi("chat", finalOutcome === "retrying" ? "warn" : "error", {
            attempt,
            browserFallbackUsed: activeVqdData?.browserFallbackUsed,
            delayMs: finalOutcome === "retrying" ? delayMs : undefined,
            finalOutcome,
            jsdomAttempts: activeVqdData?.jsdomAttempts,
            phase: "chat_stream",
            retryClass: primed.retryableError.info.retryClass,
            reusedVqd,
            status: primed.retryableError.info.status,
            type: primed.retryableError.info.type,
            overrideCode: primed.retryableError.info.overrideCode,
          });

          if (shouldRefreshDuckAiVqd(primed.retryableError.info.retryClass)) {
            activeVqdData = null;
          }

          if (attempt < DUCKAI_CHAT_MAX_ATTEMPTS) {
            await sleep(delayMs);
            continue;
          }

          return {
            response: new Response(
              JSON.stringify({ error: { message: DUCKAI_TEMPORARY_ERROR_MESSAGE, type: "upstream_error" } }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            ),
            url: CHAT_URL,
            headers: {} as Record<string, string>,
            transformedBody: body,
          };
        }

        if ("errorResponse" in primed) {
          return {
            response: primed.errorResponse,
            url: CHAT_URL,
            headers: {} as Record<string, string>,
            transformedBody: body,
          };
        }

        // Success!
        if (
          attempt > 1 ||
          activeVqdData?.browserFallbackUsed ||
          (activeVqdData?.jsdomAttempts ?? 0) > 1
        ) {
          logDuckAi("chat", "log", {
            attempt,
            browserFallbackUsed: activeVqdData?.browserFallbackUsed,
            finalOutcome: "success",
            jsdomAttempts: activeVqdData?.jsdomAttempts,
            phase: "chat_http",
            reusedVqd,
          });
        }

        return {
          response: primed.response,
          url: CHAT_URL,
          headers: {} as Record<string, string>,
          transformedBody: body,
        };
      } catch (error) {
        const retryable = isRetryableDuckAiThrownError(error);
        if (retryable) {
          const delayMs = getDuckAiRetryDelay(attempt, retryable.info.retryClass);
          const finalOutcome = attempt < DUCKAI_CHAT_MAX_ATTEMPTS ? "retrying" : "exhausted";
          logDuckAi("chat", finalOutcome === "retrying" ? "warn" : "error", {
            attempt,
            delayMs: finalOutcome === "retrying" ? delayMs : undefined,
            finalOutcome,
            phase: retryable.info.phase,
            retryClass: retryable.info.retryClass,
            status: retryable.info.status,
            type: retryable.info.type,
            overrideCode: retryable.info.overrideCode,
          });

          if (
            retryable.info.phase === "vqd" ||
            shouldRefreshDuckAiVqd(retryable.info.retryClass)
          ) {
            activeVqdData = null;
          }

          if (attempt < DUCKAI_CHAT_MAX_ATTEMPTS) {
            await sleep(delayMs);
            continue;
          }

          return {
            response: new Response(
              JSON.stringify({ error: { message: DUCKAI_TEMPORARY_ERROR_MESSAGE, type: "upstream_error" } }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            ),
            url: CHAT_URL,
            headers: {} as Record<string, string>,
            transformedBody: body,
          };
        }

        // Non-retryable error
        const errMsg = error instanceof Error ? error.message : String(error);
        log?.error?.("DUCKAI", `Non-retryable error: ${errMsg}`);
        return {
          response: new Response(
            JSON.stringify({
              error: { message: `Duck.ai internal error: ${errMsg}`, type: "upstream_error" },
            }),
            { status: 502, headers: { "Content-Type": "application/json" } }
          ),
          url: CHAT_URL,
          headers: {} as Record<string, string>,
          transformedBody: body,
        };
      }
    }

    // All attempts exhausted
    return {
      response: new Response(
        JSON.stringify({ error: { message: DUCKAI_TEMPORARY_ERROR_MESSAGE, type: "upstream_error" } }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ),
      url: CHAT_URL,
      headers: {} as Record<string, string>,
      transformedBody: body,
    };
  }
}

export default DuckAiExecutor;
