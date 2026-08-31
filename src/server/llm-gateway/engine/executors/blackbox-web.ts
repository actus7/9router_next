// Blackbox AI (app.blackbox.ai) executor.
//
// Three real bugs fixed here (ported from OmniRoute's blackbox-web.ts, which
// tracks these against a live issue #2252):
//   1. Wrong domain — the frontend lives at app.blackbox.ai, not www.blackbox.ai.
//   2. Missing `validated` field — Blackbox's /api/chat 403s every request
//      that omits or mismatches this frontend token. An operator-supplied
//      BLACKBOX_WEB_VALIDATED_TOKEN env var is honored; otherwise a random
//      UUID is sent (works only as long as Blackbox doesn't enforce a
//      specific value — see resolveBlackboxValidatedToken below).
//   3. Silent in-band errors — Blackbox answers subscription/auth/rate-limit
//      failures with HTTP 200 and an error sentence in the body, not a
//      non-2xx status. The old executor had no detection for this, so those
//      failures were returned to the client as normal assistant replies.
// Session/subscription pre-fetch (Blackbox's backend expects both in the
// request body) is also ported, cached per cookie for 5 minutes.
import { BaseExecutor } from "./base";
import type { Credentials, Logger } from "../services/types";

const BLACKBOX_CHAT_API = "https://app.blackbox.ai/api/chat";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const SESSION_CACHE_TTL_MS = 5 * 60_000;
const MAX_SESSIONS = 100;

function resolveBlackboxValidatedToken(): string {
  const explicit = (process.env.BLACKBOX_WEB_VALIDATED_TOKEN || "").trim();
  return explicit || crypto.randomUUID();
}

function isBlackboxValidatedTokenError(responseText: string): boolean {
  const lower = (responseText || "").toLowerCase();
  return lower.includes("invalid validated token") || lower.includes("invalid validated") || lower.includes("validation token") || lower.includes("invalid token");
}

interface CachedSession {
  sessionData: Record<string, unknown> | null;
  subscriptionCache: Record<string, unknown> | null;
  teamAccount: string;
  fetchedAt: number;
}
const sessionCache = new Map<string, CachedSession>();

function normalizeCookieHeader(apiKey: string): string {
  const trimmed = String(apiKey ?? "").trim();
  if (!trimmed) return "";
  return trimmed.includes("=") ? trimmed : `next-auth.session-token=${trimmed}`;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const item = part as Record<string, unknown>;
    return item && (item.type === "text" || item.type === "input_text") && typeof item.text === "string" ? item.text : "";
  }).filter((p) => p.trim().length > 0).join("\n").trim();
}

interface BlackboxMessage { id: string; role: "user" | "assistant"; content: string }

function parseOpenAIMessages(messages: Array<Record<string, unknown>>, chatId: string): BlackboxMessage[] {
  const systemParts: string[] = [];
  const parsed: BlackboxMessage[] = [];
  for (const message of messages) {
    const role = String(message.role || "user");
    const content = extractMessageText(message.content);
    if (!content) continue;
    if (role === "system" || role === "developer") { systemParts.push(content); continue; }
    if (role === "assistant" || role === "user") parsed.push({ id: role === "user" ? chatId : crypto.randomUUID(), role, content });
  }
  if (systemParts.length > 0) {
    const prefix = `System instructions:\n${systemParts.join("\n\n")}`;
    const firstUserIndex = parsed.findIndex((m) => m.role === "user");
    if (firstUserIndex >= 0) parsed[firstUserIndex] = { ...parsed[firstUserIndex], content: `${prefix}\n\n${parsed[firstUserIndex].content}` };
    else parsed.unshift({ id: chatId, role: "user", content: prefix });
  }
  return parsed;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function sseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function readTextResponse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function buildStreamingResponse(responseText: string, model: string, id: string, created: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, system_fingerprint: null, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }] })));
      if (responseText) controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, system_fingerprint: null, choices: [{ index: 0, delta: { content: responseText }, finish_reason: null, logprobs: null }] })));
      controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, system_fingerprint: null, choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }] })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }, { highWaterMark: 16384 });
}

function buildNonStreamingResponse(responseText: string, model: string, id: string, created: number) {
  const tokens = estimateTokens(responseText);
  return new Response(JSON.stringify({
    id, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: tokens, completion_tokens: tokens, total_tokens: tokens * 2 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function errorResponse(status: number, message: string, url: string, headers: Record<string, string>, body: Record<string, unknown>) {
  return { response: new Response(JSON.stringify({ error: { message, type: "upstream_error" } }), { status, headers: { "Content-Type": "application/json" } }), url, headers, transformedBody: body };
}

export class BlackboxWebExecutor extends BaseExecutor {
  constructor() {
    super("blackbox-web", { baseUrl: BLACKBOX_CHAT_API });
  }

  async execute({ model, body, stream, credentials, signal, log }: {
    model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger;
  }) {
    const messages = body?.messages as Array<Record<string, unknown>> | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return errorResponse(400, "Missing or empty messages array", BLACKBOX_CHAT_API, {}, body);
    }

    const chatId = crypto.randomUUID().slice(0, 7);
    const parsedMessages = parseOpenAIMessages(messages, chatId);
    if (parsedMessages.length === 0) {
      return errorResponse(400, "Empty query after processing messages", BLACKBOX_CHAT_API, {}, body);
    }

    const cookieHeader = normalizeCookieHeader(String(credentials.apiKey ?? ""));
    const baseHeaders: Record<string, string> = {
      Accept: "application/json",
      Cookie: cookieHeader,
      Origin: "https://app.blackbox.ai",
      "User-Agent": USER_AGENT,
    };

    let sessionData: Record<string, unknown> | null = null;
    let subscriptionCache: Record<string, unknown> | null = null;
    let teamAccount = "";

    const cached = sessionCache.get(cookieHeader);
    if (cached && Date.now() - cached.fetchedAt < SESSION_CACHE_TTL_MS) {
      ({ sessionData, subscriptionCache, teamAccount } = cached);
    } else {
      const sideSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
      try {
        const sessionRes = await fetch("https://app.blackbox.ai/api/auth/session", { method: "GET", headers: baseHeaders, signal: sideSignal });
        sessionData = sessionRes.ok ? await sessionRes.json() : null;
        const email = (sessionData as { user?: { email?: string } } | null)?.user?.email;
        teamAccount = email || "";

        if (email) {
          const subRes = await fetch("https://app.blackbox.ai/api/check-subscription", {
            method: "POST", headers: { ...baseHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ email }), signal: sideSignal,
          });
          const rawSub = subRes.ok ? await subRes.json() as Record<string, unknown> : null;
          if (rawSub) {
            subscriptionCache = {
              status: rawSub.hasActiveSubscription ? "PREMIUM" : "FREE",
              customerId: rawSub.customerId ?? null,
              expiryTimestamp: rawSub.expiryTimestamp ?? null,
              lastChecked: Date.now(),
              isTrialSubscription: rawSub.isTrialSubscription ?? false,
              isTeam: rawSub.isTeam ?? false,
              numSeats: rawSub.numSeats ?? 1,
              provider: rawSub.provider ?? null,
            };
          }
        }
        sessionCache.set(cookieHeader, { sessionData, subscriptionCache, teamAccount, fetchedAt: Date.now() });
        while (sessionCache.size > MAX_SESSIONS) {
          const oldestKey = sessionCache.keys().next().value;
          if (oldestKey !== undefined) sessionCache.delete(oldestKey); else break;
        }
      } catch (diagErr) {
        log?.debug?.("BLACKBOX-WEB", `Session/subscription fetch failed (non-fatal): ${diagErr}`);
      }
    }

    const headers: Record<string, string> = { ...baseHeaders, Accept: "text/plain, */*", "Content-Type": "application/json", Referer: `https://app.blackbox.ai/chat/${chatId}` };

    const transformedBody: Record<string, unknown> = {
      messages: parsedMessages, id: chatId, previewToken: null,
      userId: credentials.providerSpecificData?.userId ?? null,
      codeModelMode: true, trendingAgentMode: {}, isMicMode: false, userSystemPrompt: null,
      maxTokens: Number(body.max_tokens) || 1024, playgroundTopP: null, playgroundTemperature: null,
      isChromeExt: false, githubToken: "", clickedAnswer2: false, clickedAnswer3: false,
      clickedForceWebSearch: false, visitFromDelta: false, isMemoryEnabled: false, mobileClient: false,
      userSelectedModel: model || null, userSelectedAgent: "VscodeAgent",
      validated: resolveBlackboxValidatedToken(),
      imageGenerationMode: false, imageGenMode: "autoMode", webSearchModePrompt: false, deepSearchMode: false,
      promptSelection: "", domains: null, vscodeClient: false, codeInterpreterMode: false,
      customProfile: { name: "", occupation: "", traits: [], additionalInfo: "", enableNewChats: false },
      webSearchModeOption: { autoMode: true, webMode: false, offlineMode: false },
      session: sessionData,
      isPremium: subscriptionCache ? subscriptionCache.status === "PREMIUM" : (credentials.providerSpecificData?.isPremium ?? true),
      teamAccount, subscriptionCache, beastMode: false, reasoningMode: false, designerMode: false,
      workspaceId: "", asyncMode: false, integrations: {}, isTaskPersistent: false, selectedElement: null,
    };

    const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);

    log?.info?.("BLACKBOX-WEB", `Query to ${model}, msgs=${messages.length}`);

    let upstream: Response;
    try {
      upstream = await fetch(BLACKBOX_CHAT_API, { method: "POST", headers, body: JSON.stringify(transformedBody), signal: combinedSignal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("BLACKBOX-WEB", `Fetch failed: ${msg}`);
      return errorResponse(502, `Blackbox Web connection failed: ${msg}`, BLACKBOX_CHAT_API, headers, transformedBody);
    }

    if (!upstream.ok) {
      const status = upstream.status;
      const errText = await upstream.text().catch(() => "");
      let message = `Blackbox Web returned HTTP ${status}`;
      if (status === 403 && isBlackboxValidatedTokenError(errText)) {
        message = "Blackbox Web rejected the request with an invalid `validated` token. If you have a valid frontend token (the `tk` value from app.blackbox.ai's Next.js bundle), set BLACKBOX_WEB_VALIDATED_TOKEN in your environment and restart.";
      } else if (status === 401 || status === 403) {
        message = "Blackbox Web auth failed — your app.blackbox.ai session cookie may be missing or expired.";
      } else if (status === 429) {
        message = "Blackbox Web rate limited the session. Wait a moment and retry.";
      }
      return errorResponse(status, message, BLACKBOX_CHAT_API, headers, transformedBody);
    }

    if (!upstream.body) {
      return errorResponse(502, "Blackbox Web returned an empty response body", BLACKBOX_CHAT_API, headers, transformedBody);
    }

    const responseText = (await readTextResponse(upstream.body, signal)).trim();

    // Blackbox sometimes answers with HTTP 200 and an in-band error sentence
    // instead of a real status code — without this check those become
    // "successful" assistant replies containing an error message.
    const lowerText = responseText.toLowerCase();
    const isSubscriptionError = /not upgraded|upgrade to a premium plan|upgrade.required/i.test(responseText) || lowerText.includes("please upgrade");
    const isAuthError = /please login|login required|authentication required/i.test(responseText) && !isSubscriptionError;
    const isRateLimit = /rate limit|too many requests/i.test(responseText) && !isSubscriptionError;

    if (isSubscriptionError) {
      return errorResponse(402, "Blackbox reports your account lacks a premium subscription. If you have a paid plan, re-paste your session cookie from app.blackbox.ai.", BLACKBOX_CHAT_API, headers, transformedBody);
    }
    if (isAuthError) {
      return errorResponse(401, "Blackbox session is not authenticated — re-paste next-auth.session-token from app.blackbox.ai", BLACKBOX_CHAT_API, headers, transformedBody);
    }
    if (isRateLimit) {
      return errorResponse(429, "Blackbox Web rate limited the session. Wait a moment and retry.", BLACKBOX_CHAT_API, headers, transformedBody);
    }

    const id = `chatcmpl-blackbox-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const finalResponse = stream
      ? new Response(buildStreamingResponse(responseText, model, id, created), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } })
      : buildNonStreamingResponse(responseText, model, id, created);

    return { response: finalResponse, url: BLACKBOX_CHAT_API, headers, transformedBody };
  }
}

export default BlackboxWebExecutor;
