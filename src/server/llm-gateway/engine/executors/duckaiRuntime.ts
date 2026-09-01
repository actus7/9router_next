import { createHash } from "node:crypto";
import { PROVIDERS } from "../config/providers";
import { sseChunk } from "../utils/sse";
import {
  getDuckAiChallengeRuntime,
  solveVqdChallengeMultiLayer,
  type VqdChallengeResult,
} from "./duckai-challenge";

export const CHAT_URL = PROVIDERS["duckai"]?.baseUrl as string || "https://duck.ai/duckchat/v1/chat";
const AUTH_TOKEN_URL = "https://duck.ai/duckchat/v1/auth/token";
const STATUS_URL = "https://duck.ai/duckchat/v1/status";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

export const DUCKAI_TEMPORARY_ERROR_MESSAGE =
  "Duck.ai is temporarily unavailable. Please try again in a few moments.";

export const DUCKAI_CHAT_MAX_ATTEMPTS = readNumberEnv("DUCKAI_CHAT_MAX_ATTEMPTS", 5);
const DUCKAI_CHAT_RETRY_BASE_DELAY_MS = readNumberEnv("DUCKAI_CHAT_RETRY_BASE_DELAY_MS", 750);
const DUCKAI_CHAT_RETRY_MAX_DELAY_MS = readNumberEnv("DUCKAI_CHAT_RETRY_MAX_DELAY_MS", 5000);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DdgMessage = { role: "user" | "assistant"; content: string };
export type DuckAiReasoningEffort = "minimal" | "low";
export type DuckAiRetryClass = "bn_limit" | "challenge" | "empty_stream" | "network" | "timeout";
export type DuckAiRetryPhase = "chat_http" | "chat_stream" | "chat_stream_prelude" | "vqd";

export type DuckAiVqdData = {
  browserFallbackUsed: boolean;
  cookies: string;
  hashPayload: string;
  jsdomAttempts: number;
};

export type DuckAiSseEvent =
  | { kind: "content"; content: string }
  | {
      kind: "error";
      message: string;
      overrideCode?: string;
      retryClass?: DuckAiRetryClass;
      type?: string;
    };

export type DuckAiUpstreamErrorInfo = {
  overrideCode?: string;
  status?: number;
  type?: string;
};

export class DuckAiRetryableError extends Error {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SHA-256 of a string, returned as base64 (sync, using node:crypto) */
function sha256Base64(text: string): string {
  return createHash("sha256").update(text).digest("base64");
}

export function isJson(str: string): boolean {
  try {
    return str !== null && JSON.parse(str) !== null;
  } catch {
    return false;
  }
}

export function mergeCookies(...cookieHeaders: Array<string | undefined>): string {
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

export function appendResponseCookies(existingCookies: string, headers: Headers): string {
  return mergeCookies(existingCookies, getCookieHeaderValue(headers));
}

// ---------------------------------------------------------------------------
// Shared encoding / response helpers
// ---------------------------------------------------------------------------

/** Encode a single OpenAI chat.completion.chunk SSE frame for Duck.ai. */
export function encodeDuckAiChunk(
  encoder: TextEncoder,
  cid: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason?: string | null
): Uint8Array {
  return encoder.encode(
    sseChunk({
      id: cid,
      object: "chat.completion.chunk",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason ?? null,
          logprobs: null,
        },
      ],
    })
  );
}

/** Build a JSON error Response with the standard Duck.ai envelope. */
export function buildDuckAiErrorResponse(
  status: number,
  error: {
    message: string;
    type: string;
    code?: string;
    overrideCode?: string;
    upstreamType?: string;
  }
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build the standard 503 "temporary unavailable" result used across retries. */
export function buildDuckAiTemporaryErrorResponse(body: Record<string, unknown>) {
  return {
    response: buildDuckAiErrorResponse(503, {
      message: DUCKAI_TEMPORARY_ERROR_MESSAGE,
      type: "upstream_error",
    }),
    url: CHAT_URL,
    headers: {} as Record<string, string>,
    transformedBody: body,
  };
}

/**
 * Log a retry attempt and decide whether to retry or give up.
 * Returns the delay, whether to retry, and whether to refresh VQD data.
 */
export function logAndDecideDuckAiRetry(
  attempt: number,
  retryClass: DuckAiRetryClass,
  phase: DuckAiRetryPhase,
  info: DuckAiUpstreamErrorInfo,
  opts: {
    activeVqdData?: DuckAiVqdData | null;
    reusedVqd?: boolean;
    forceRefreshVqd?: boolean;
  } = {}
): { delayMs: number; shouldRetry: boolean; refreshVqd: boolean } {
  const delayMs = getDuckAiRetryDelay(attempt, retryClass);
  const shouldRetry = attempt < DUCKAI_CHAT_MAX_ATTEMPTS;
  const finalOutcome = shouldRetry ? "retrying" : "exhausted";

  const logPayload: Record<string, unknown> = {
    attempt,
    delayMs: shouldRetry ? delayMs : undefined,
    finalOutcome,
    phase,
    retryClass,
    status: info.status,
    type: info.type,
    overrideCode: info.overrideCode,
  };
  if (opts.activeVqdData) {
    logPayload.browserFallbackUsed = opts.activeVqdData.browserFallbackUsed;
    logPayload.jsdomAttempts = opts.activeVqdData.jsdomAttempts;
  }
  if (opts.reusedVqd !== undefined) {
    logPayload.reusedVqd = opts.reusedVqd;
  }

  logDuckAi("chat", shouldRetry ? "warn" : "error", logPayload);

  const refreshVqd =
    opts.forceRefreshVqd === true || shouldRefreshDuckAiVqd(retryClass);

  return { delayMs, shouldRetry, refreshVqd };
}

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

export function logDuckAi(
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

export function isRetryableDuckAiHttpFailure(
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

export function isRetryableDuckAiThrownError(error: unknown): DuckAiRetryableError | null {
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

export const STATUS_HEADERS: Record<string, string> = {
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

export async function fetchWithTimeout(
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
export async function getVqdData(seedCookies = ""): Promise<DuckAiVqdData> {
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

// Public runtime entry point consumed by the executor orchestration module.
void getVqdData;

// ---------------------------------------------------------------------------
// Duck.ai SSE parsing
// ---------------------------------------------------------------------------
