// DeepSeek Web (chat.deepseek.com) executor.
//
// The previous version of this executor sent an OpenAI-shaped
// {model, messages, stream} body straight to a made-up
// /api/v0/chat/completions URL. The real flow requires four steps before any
// text comes back:
//   1. Exchange the pasted `userToken` for a short-lived access token via
//      POST /api/v0/users/current (cached ~1h).
//   2. Create a chat session (POST /api/v0/chat_session/create).
//   3. Solve a proof-of-work challenge (POST /api/v0/chat/create_pow_challenge,
//      then a DeepSeekHashV1 nonce search — see powHash.ts) and send the
//      answer as the X-Ds-Pow-Response header. Without this the completion
//      endpoint rejects the request outright.
//   4. POST /api/v0/chat/completion with a single `prompt` string (not an
//      OpenAI `messages` array) and parse DeepSeek's own fragment-based SSE
//      envelope (thinking vs answer paths, search citations).
// Ported from OmniRoute's deepseek-web.ts. Tool-calling translation
// (<tool>...</tool> prompt contract) and cross-request session persistence
// were left out — same simplification pattern as the other ports in this
// batch — but the auto-history-window prompt folding was kept since it fixes
// a real correctness bug (agentic multi-turn clients losing context after a
// couple of turns).
import { BaseExecutor } from "./base";
import type { Credentials, Logger } from "../services/types";
import { solveDeepSeekPow } from "./deepseek-web/powHash";
import { isThinkingModel, isSearchModel, formatStreamContent, appendSearchCitations, type DeepSeekSearchResult } from "./deepseek-web/streamFormat";
import { createFinishOnceGuard, createFinishedDrainScheduler } from "./deepseek-web/doneTerminator";

const DEEPSEEK_WEB_BASE = "https://chat.deepseek.com";
const DEEPSEEK_API_BASE = `${DEEPSEEK_WEB_BASE}/api`;
const COMPLETION_URL = `${DEEPSEEK_API_BASE}/v0/chat/completion`;

const FAKE_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: DEEPSEEK_WEB_BASE,
  Referer: `${DEEPSEEK_WEB_BASE}/`,
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "X-Client-Bundle-Id": "com.deepseek.chat",
  "X-Client-Locale": "en-US",
  "X-Client-Platform": "web",
  "X-Client-Version": "2.0.0",
};

interface PowChallenge {
  algorithm: string; challenge: string; salt: string; signature: string;
  difficulty: number; expire_at: number; expire_after: number; target_path: string;
}
interface TokenInfo { accessToken: string; expiresAt: number }

const tokenCache = new Map<string, TokenInfo>();
const CACHE_MAX_SIZE = 100;

function evictOldest(cache: Map<string, unknown>): void {
  if (cache.size >= CACHE_MAX_SIZE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

function extractUserToken(credentials: Credentials): string | null {
  const raw = credentials?.apiKey || credentials?.accessToken;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.value === "string") return parsed.value;
  } catch { /* not JSON, use raw */ }
  return raw;
}

function errorResponse(status: number, message: string, dsCode?: number): Response {
  return new Response(JSON.stringify({ error: { message, type: "upstream_error", code: dsCode ?? `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
}

function resolveModelOptions(model: string | undefined, bodyObj: Record<string, unknown>): { modelType: string; thinkingEnabled: boolean; searchEnabled: boolean } {
  const m = (model || "").toLowerCase();
  const modelType = m.includes("pro") || m.includes("expert") ? "expert" : "default";
  const thinkingEnabled = m.includes("r1") || m.includes("think") || m.includes("reason") || bodyObj?.thinking_enabled === true || bodyObj?.thinking === true || !!bodyObj?.reasoning_effort;
  const searchEnabled = m.includes("search") || bodyObj?.search_enabled === true || bodyObj?.search === true || bodyObj?.web_search === true;
  return { modelType, thinkingEnabled, searchEnabled };
}

function generateFakeCookie(): string {
  const ts = Date.now();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const uid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
  return `intercom-HWWAFSESTIME=${ts}; HWWAFSESID=${hex(18)}; Hm_lvt_${uid()}=${Math.floor(ts / 1000)}; _frid=${uid()}`;
}

async function solvePowChallenge(challenge: PowChallenge): Promise<string> {
  const answer = solveDeepSeekPow(challenge.algorithm, challenge.challenge, challenge.salt, challenge.difficulty, challenge.expire_at);
  if (answer < 0) throw new Error("PoW solver failed");
  return Buffer.from(JSON.stringify({
    algorithm: challenge.algorithm, challenge: challenge.challenge, salt: challenge.salt,
    answer, signature: challenge.signature, target_path: challenge.target_path,
  })).toString("base64");
}

function extractMessageText(content: unknown): string {
  if (Array.isArray(content)) {
    return content.filter((item: Record<string, unknown>) => item.type === "text").map((item: Record<string, unknown>) => item.text as string).join("\n");
  }
  return String(content || "");
}

const DEFAULT_AUTO_HISTORY_WINDOW = 20;

/** Build the single prompt string the DeepSeek web API accepts (it takes only
 * a `prompt` string, not a `messages` array). Genuinely multi-turn history
 * (any assistant turn present) is stitched into a role-tagged transcript so
 * context isn't lost after a couple of turns; single-turn stays minimal. */
function messagesToPrompt(messages: Array<{ role: string; content: unknown; tool_call_id?: string; name?: string }>): string {
  if (messages.length === 0) return "";
  const systemParts: string[] = [];
  const conversation: Array<{ role: string; text: string }> = [];
  const callNameById = new Map<string, string>();
  let lastUserContent = "";
  for (const m of messages) {
    const text = extractMessageText(m.content).trim();
    if (m.role === "system") {
      if (text) systemParts.push(text);
    } else if (m.role === "user" || m.role === "assistant") {
      if (text) conversation.push({ role: m.role, text });
      if (m.role === "user") lastUserContent = text;
      const toolCalls = (m as { tool_calls?: unknown }).tool_calls;
      const calls = Array.isArray(toolCalls) ? toolCalls as Array<{ id?: string; function?: { name?: string } }> : [];
      for (const c of calls) if (c?.id && typeof c.function?.name === "string") callNameById.set(c.id, c.function.name);
    } else if (m.role === "tool") {
      if (text) {
        const name = (m.tool_call_id && callNameById.get(m.tool_call_id)) || m.name || "tool";
        conversation.push({ role: "tool", text: `(${name}) ${text}` });
      }
    }
  }

  const parts: string[] = [];
  if (systemParts.length > 0) parts.push(systemParts.join("\n\n"));

  const effectiveWindow = conversation.length > 1 ? DEFAULT_AUTO_HISTORY_WINDOW : 0;
  if (effectiveWindow > 0 && conversation.length > 1) {
    const recent = conversation.slice(-effectiveWindow);
    const transcript = recent.map((turn) => turn.role === "assistant" ? `Assistant: ${turn.text}` : turn.role === "tool" ? `Tool result ${turn.text}` : `User: ${turn.text}`).join("\n\n");
    parts.push(transcript);
  } else if (lastUserContent) {
    parts.push(lastUserContent);
  }

  return parts.join("\n\n").replace(/!\[.*?\]\(.*?\)/g, "");
}

async function acquireAccessToken(userToken: string, signal: AbortSignal | undefined, log: Logger | undefined): Promise<string> {
  const cached = tokenCache.get(userToken);
  if (cached && cached.expiresAt > Math.floor(Date.now() / 1000)) return cached.accessToken;

  log?.info?.("DEEPSEEK-WEB", "Acquiring access token from /users/current...");
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/users/current`, { headers: { ...FAKE_HEADERS, Authorization: `Bearer ${userToken}` }, signal });

  if (resp.status === 401 || resp.status === 403) throw new Error("Token invalid or expired — get a new userToken from DeepSeek localStorage");
  if (!resp.ok) throw new Error(`users/current HTTP ${resp.status}`);

  const json = await resp.json() as Record<string, unknown>;
  if (json?.code && json.code !== 0) {
    const data = json.data as Record<string, unknown> | undefined;
    const errMsg = json.msg || data?.biz_msg || `error code ${json.code}`;
    tokenCache.delete(userToken);
    throw new Error(`DeepSeek rejected token: ${errMsg}`);
  }
  const data = json?.data as Record<string, unknown> | undefined;
  const bizData = (data?.biz_data ?? json?.biz_data) as Record<string, unknown> | undefined;
  if (!bizData?.token) {
    const errMsg = json?.msg || data?.biz_msg || "Unknown error";
    throw new Error(`Failed to acquire token: ${errMsg}`);
  }

  const accessToken = bizData.token as string;
  evictOldest(tokenCache);
  tokenCache.set(userToken, { accessToken, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  return accessToken;
}

function parseDeepSeekErrorPayload(payload: unknown): { code?: number; message: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const code = typeof record.code === "number" ? record.code : undefined;
  const data = record.data as Record<string, unknown> | undefined;
  const bizMsg = data?.biz_msg;
  const messageRaw = typeof record.msg === "string" ? record.msg : typeof bizMsg === "string" ? bizMsg : "";
  if (code !== undefined && code !== 0) return { code, message: messageRaw || `DeepSeek error ${code}` };
  return null;
}

async function createSession(accessToken: string, signal: AbortSignal | undefined): Promise<string> {
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/chat_session/create`, {
    method: "POST", headers: { ...FAKE_HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, Cookie: generateFakeCookie() },
    body: JSON.stringify({}), signal,
  });
  if (!resp.ok) throw new Error(`chat_session/create HTTP ${resp.status}`);
  const json = await resp.json() as Record<string, unknown>;
  const data = json?.data as Record<string, unknown> | undefined;
  const bizData = (data?.biz_data ?? json?.biz_data) as Record<string, unknown> | undefined;
  const session = bizData?.chat_session as Record<string, unknown> | undefined;
  const id = session?.id as string | undefined;
  if (!id) throw new Error(`No session id: code=${json?.code}`);
  return id;
}

async function deleteSessionOnDeepSeek(accessToken: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${DEEPSEEK_API_BASE}/v0/chat_session/delete`, {
      method: "POST", headers: { ...FAKE_HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ chat_session_id: sessionId }),
    });
  } catch { /* best-effort cleanup */ }
}

async function getPowChallenge(accessToken: string, signal: AbortSignal | undefined): Promise<PowChallenge> {
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/chat/create_pow_challenge`, {
    method: "POST", headers: { ...FAKE_HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ target_path: "/api/v0/chat/completion" }), signal,
  });
  if (!resp.ok) throw new Error(`create_pow_challenge HTTP ${resp.status}`);
  const json = await resp.json() as Record<string, unknown>;
  const data = json?.data as Record<string, unknown> | undefined;
  const bizData = (data?.biz_data ?? json?.biz_data) as Record<string, unknown> | undefined;
  const challenge = bizData?.challenge as Record<string, unknown> | undefined;
  if (!challenge?.challenge) throw new Error(`No PoW challenge: code=${json?.code}`);
  return challenge as unknown as PowChallenge;
}

function wrapStreamWithCleanup(responseStream: ReadableStream, cleanup: () => Promise<void>): ReadableStream {
  const reader = responseStream.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); cleanup().catch(() => {}); return; }
      controller.enqueue(value);
    },
    cancel() { reader.cancel(); cleanup().catch(() => {}); },
  });
}

interface StreamFragment { type?: string; content?: string }

function transformSSE(deepseekStream: ReadableStream, model: string): ReadableStream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const streamModel = model || "deepseek-web";
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let emittedRole = false;
  let currentPath: "thinking" | "content" | "" = "";
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults: DeepSeekSearchResult[] = [];

  return new ReadableStream({
    async start(controller) {
      const reader = deepseekStream.getReader();
      let buffer = "";

      const emit = (obj: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const chunk = (delta: object, finish?: string) => emit({ id, object: "chat.completion.chunk", created, model: streamModel, choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
      const ensureRole = () => { if (!emittedRole) { emittedRole = true; chunk({ role: "assistant", content: "" }); } };

      const { finishOnce: finishStream, hasFinished } = createFinishOnceGuard(() => {
        const citations = appendSearchCitations(searchResults, streamModel);
        if (citations) { ensureRole(); chunk({ content: `\n\n${citations}` }); }
        ensureRole();
        chunk({}, "stop");
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      });

      const { scheduleFinishAfterDrain, clearFinishedDrain, isDrainPending } = createFinishedDrainScheduler(finishStream);

      const sendByPath = (raw: string) => {
        const text = formatStreamContent(raw, streamModel);
        if (!text) return;
        ensureRole();
        let path = currentPath;
        if (!path && thinkingModel) path = "thinking";
        else if (!path && isSearchModel(streamModel)) path = "content";
        chunk(path === "thinking" ? { reasoning_content: text } : { content: text });
      };

      const handleFragment = (frag: StreamFragment, setPathFromType: boolean) => {
        const type = String(frag?.type || "").toUpperCase();
        if (setPathFromType) { if (type === "THINK") currentPath = "thinking"; else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content"; }
        if (typeof frag?.content !== "string" || frag.content.length === 0) return;
        if (!setPathFromType) { if (type === "THINK") currentPath = "thinking"; else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content"; }
        sendByPath(frag.content);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
            const payload = line.replace(/^data:\s*/, "").trim();
            if (payload === "[DONE]") { finishStream(); return; }

            let data: Record<string, unknown>;
            try { data = JSON.parse(payload); } catch { continue; }

            const p = data?.p as string | undefined;
            const o = data?.o as string | undefined;
            const v = data?.v as unknown;

            if (v && typeof v === "object" && (v as Record<string, unknown>).response) {
              const response = (v as Record<string, unknown>).response as Record<string, unknown>;
              if (response.thinking_enabled === true) currentPath = "thinking";
              else if (response.thinking_enabled === false) currentPath = "content";
              const fragments = response.fragments;
              if (Array.isArray(fragments)) for (const frag of fragments) handleFragment(frag, false);
            }

            if (p === "response/fragments") {
              if (Array.isArray(v)) for (const frag of v) handleFragment(frag, true);
              else if (v && typeof v === "object") handleFragment(v as StreamFragment, true);
            }

            if (p === "response" && Array.isArray(v)) {
              for (const entry of v) {
                const e = entry as Record<string, unknown>;
                if (e?.p === "response" && (e?.v as Record<string, unknown>)?.thinking_enabled === true) currentPath = "thinking";
              }
            }

            if (p === "response/search_status") continue;

            if (p === "response/search_results" && Array.isArray(v)) {
              if (o !== "BATCH") { searchResults.length = 0; searchResults.push(...(v as DeepSeekSearchResult[])); }
              else {
                for (const op of v) {
                  const opRec = op as Record<string, unknown>;
                  const match = String(opRec?.p || "").match(/^(\d+)\/cite_index$/);
                  if (match) { const index = parseInt(match[1], 10); if (searchResults[index]) searchResults[index].cite_index = opRec.v as number; }
                }
              }
              continue;
            }

            if (typeof v === "string") {
              sendByPath(v);
            } else if (Array.isArray(v) && p === "response") {
              for (const entry of v) {
                const e = entry as Record<string, unknown>;
                if (Array.isArray(e?.v)) {
                  const joined = (e.v as Array<Record<string, unknown>>).map((item) => (item?.content as string) || "").join("");
                  if (joined) sendByPath(joined);
                }
              }
            }

            if (p === "response/status" && v === "FINISHED") { scheduleFinishAfterDrain(); continue; }
            if (isDrainPending()) scheduleFinishAfterDrain();
          }
        }
      } catch (err) {
        clearFinishedDrain();
        if (!hasFinished()) controller.error(err);
        return;
      }
      finishStream();
    },
  }, { highWaterMark: 16384 });
}

async function collectSSEContent(deepseekStream: ReadableStream, model: string): Promise<{ content: string; reasoningContent: string }> {
  const decoder = new TextDecoder();
  const reader = deepseekStream.getReader();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let currentPath: "thinking" | "content" | "" = "";
  const streamModel = model || "deepseek-web";
  const thinkingModel = isThinkingModel(streamModel);
  const searchResults: DeepSeekSearchResult[] = [];

  const appendByPath = (raw: string) => {
    const text = formatStreamContent(raw, streamModel);
    if (!text) return;
    let path = currentPath;
    if (!path && thinkingModel) path = "thinking";
    else if (!path && isSearchModel(streamModel)) path = "content";
    if (path === "thinking") reasoningContent += text; else content += text;
  };

  const handleFragment = (frag: StreamFragment, setPathFromType: boolean) => {
    const type = String(frag?.type || "").toUpperCase();
    if (setPathFromType) { if (type === "THINK") currentPath = "thinking"; else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content"; }
    if (typeof frag?.content !== "string" || frag.content.length === 0) return;
    if (!setPathFromType) { if (type === "THINK") currentPath = "thinking"; else if (type === "ANSWER" || type === "RESPONSE") currentPath = "content"; }
    appendByPath(frag.content);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ") && !line.startsWith("data:")) continue;
      const payload = line.replace(/^data:\s*/, "").trim();
      try {
        const data = JSON.parse(payload) as Record<string, unknown>;
        const p = data?.p as string | undefined;
        const v = data?.v as unknown;

        if (v && typeof v === "object" && (v as Record<string, unknown>).response) {
          const response = (v as Record<string, unknown>).response as Record<string, unknown>;
          if (response.thinking_enabled === true) currentPath = "thinking";
          else if (response.thinking_enabled === false) currentPath = "content";
          if (Array.isArray(response.fragments)) for (const frag of response.fragments) handleFragment(frag, false);
        }
        if (p === "response/fragments") {
          if (Array.isArray(v)) for (const frag of v) handleFragment(frag, true);
          else if (v && typeof v === "object") handleFragment(v as StreamFragment, true);
        }
        if (p === "response" && Array.isArray(v)) {
          for (const entry of v) {
            const e = entry as Record<string, unknown>;
            if (e?.p === "response" && (e?.v as Record<string, unknown>)?.thinking_enabled === true) currentPath = "thinking";
          }
        }
        if (p === "response/search_status") continue;
        if (p === "response/search_results" && Array.isArray(v)) {
          if (data?.o !== "BATCH") { searchResults.length = 0; searchResults.push(...(v as DeepSeekSearchResult[])); }
          else {
            for (const op of v) {
              const opRec = op as Record<string, unknown>;
              const match = String(opRec?.p || "").match(/^(\d+)\/cite_index$/);
              if (match) { const index = parseInt(match[1], 10); if (searchResults[index]) searchResults[index].cite_index = opRec.v as number; }
            }
          }
          continue;
        }
        if (typeof v === "string") {
          appendByPath(v);
        } else if (Array.isArray(v) && p === "response") {
          for (const entry of v) {
            const e = entry as Record<string, unknown>;
            if (Array.isArray(e?.v)) {
              const joined = (e.v as Array<Record<string, unknown>>).map((item) => (item?.content as string) || "").join("");
              if (joined) appendByPath(joined);
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  const citations = appendSearchCitations(searchResults, streamModel);
  if (citations) content += `\n\n${citations}`;
  return { content, reasoningContent };
}

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() {
    super("deepseek-web", { baseUrl: DEEPSEEK_WEB_BASE });
  }

  async execute({ model, body, stream, credentials, signal, log }: {
    model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger;
  }) {
    const messages = (Array.isArray(body.messages) ? body.messages : []) as Array<{ role: string; content: unknown; tool_call_id?: string; name?: string }>;

    const userToken = extractUserToken(credentials);
    if (!userToken) {
      return { response: errorResponse(400, "Invalid credentials: paste your userToken from DeepSeek localStorage (DevTools → Application → Local Storage → chat.deepseek.com → userToken)"), url: COMPLETION_URL, headers: {}, transformedBody: body };
    }

    const { modelType, thinkingEnabled, searchEnabled } = resolveModelOptions(model, body);

    try {
      let t0 = Date.now();
      const accessToken = await acquireAccessToken(userToken, signal, log);
      log?.info?.("DEEPSEEK-WEB", `Token acquired in ${Date.now() - t0}ms`);

      const prompt = messagesToPrompt(messages);
      const refFileIds = Array.isArray(body.ref_file_ids) ? body.ref_file_ids : [];
      log?.info?.("DEEPSEEK-WEB", `model_type=${modelType}, thinking=${thinkingEnabled}, search=${searchEnabled}, files=${refFileIds.length}, stream=${stream !== false}`);

      const performCompletion = async (sid: string) => {
        const powChallenge = await getPowChallenge(accessToken, signal);
        const powAnswer = await solvePowChallenge(powChallenge);
        const reqHeaders: Record<string, string> = {
          ...FAKE_HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`,
          "X-Ds-Pow-Response": powAnswer, "X-Client-Timezone-Offset": String(new Date().getTimezoneOffset() * -60),
          Cookie: generateFakeCookie(),
        };
        const requestPayload = {
          chat_session_id: sid, parent_message_id: null, model_type: modelType, prompt,
          ref_file_ids: refFileIds, thinking_enabled: thinkingEnabled, search_enabled: searchEnabled, preempt: false,
        };
        const resp = await fetch(COMPLETION_URL, { method: "POST", headers: reqHeaders, body: JSON.stringify(requestPayload), signal });
        return { resp, reqHeaders, requestPayload };
      };

      t0 = Date.now();
      const sessionId = await createSession(accessToken, signal);
      log?.info?.("DEEPSEEK-WEB", `Session created in ${Date.now() - t0}ms`);

      t0 = Date.now();
      const { resp, reqHeaders, requestPayload } = await performCompletion(sessionId);
      log?.info?.("DEEPSEEK-WEB", `Completion response in ${Date.now() - t0}ms, status=${resp.status}`);

      if (!resp.ok) {
        const status = resp.status;
        let errMsg = `DeepSeek API error (${status})`;
        if (status === 401 || status === 403) { tokenCache.delete(userToken); errMsg = "DeepSeek token expired — get a fresh userToken from localStorage."; }
        else if (status === 429) errMsg = "DeepSeek rate limited. Wait and retry.";
        try {
          const errBody = await resp.json() as Record<string, unknown>;
          if (errBody?.code && errBody.code !== 0) errMsg = `DeepSeek error ${errBody.code}: ${errBody.msg}`;
        } catch { /* ignore */ }
        deleteSessionOnDeepSeek(accessToken, sessionId).catch(() => {});
        return { response: errorResponse(status, errMsg), url: COMPLETION_URL, headers: reqHeaders, transformedBody: requestPayload };
      }

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        try {
          const json = await resp.json();
          const parsed = parseDeepSeekErrorPayload(json);
          if (parsed) {
            const errMsg = `DeepSeek error ${parsed.code}: ${parsed.message}`;
            const status = parsed.code === 40003 ? 401 : parsed.code === 40002 ? 429 : 502;
            if (parsed.code === 40003) tokenCache.delete(userToken);
            deleteSessionOnDeepSeek(accessToken, sessionId).catch(() => {});
            return { response: errorResponse(status, errMsg, parsed.code), url: COMPLETION_URL, headers: reqHeaders, transformedBody: requestPayload };
          }
          deleteSessionOnDeepSeek(accessToken, sessionId).catch(() => {});
          return { response: new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } }), url: COMPLETION_URL, headers: reqHeaders, transformedBody: requestPayload };
        } catch { /* not JSON, continue */ }
      }

      const cleanupFn = () => deleteSessionOnDeepSeek(accessToken, sessionId);
      const clientModel = typeof model === "string" && model.trim() ? model.trim() : "deepseek-web";

      if (stream !== false) {
        const openaiStream = transformSSE(resp.body!, clientModel);
        const wrappedStream = wrapStreamWithCleanup(openaiStream, cleanupFn);
        return { response: new Response(wrappedStream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }), url: COMPLETION_URL, headers: reqHeaders, transformedBody: requestPayload };
      }

      const { content, reasoningContent } = await collectSSEContent(resp.body!, clientModel);
      await cleanupFn();
      const message: Record<string, string> = { role: "assistant", content };
      if (reasoningContent) message.reasoning_content = reasoningContent;
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: model || modelType,
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return { response: new Response(JSON.stringify(openaiResponse), { status: 200, headers: { "Content-Type": "application/json" } }), url: COMPLETION_URL, headers: reqHeaders, transformedBody: requestPayload };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("DEEPSEEK-WEB", `Execute failed: ${msg}`);
      if (err instanceof Error && err.name === "AbortError") {
        return { response: errorResponse(499, "Request cancelled"), url: COMPLETION_URL, headers: {}, transformedBody: body };
      }
      return { response: errorResponse(502, `DeepSeek error: ${msg}`), url: COMPLETION_URL, headers: {}, transformedBody: body };
    }
  }
}

export default DeepSeekWebExecutor;
