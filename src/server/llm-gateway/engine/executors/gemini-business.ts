import { createHash } from "node:crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import { sseChunk } from "../utils/sse";
import type { Credentials, Logger } from "../services/types";

// Gemini Business (enterprise) uses the SAME internal StreamGenerate API as
// consumer Gemini, but under the caller's own enterprise tenant path
// (business.gemini.google/home/cid/{CID}) — not gemini.google.com, and not a
// bare 7-slot inner array. Our previous executor hit the wrong Google product
// entirely with a body shape too thin for the real parser to accept.
const DEFAULT_ENTRY_URL = PROVIDERS["gemini-business"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

/** Model id → StreamGenerate MODE_CATEGORY enum (inner array slot 79). */
const MODEL_CATEGORY_MAP: Record<string, number> = {
  "gemini-3-pro": 70,
  "gemini-3-ultra": 71,
  "gemini-3-flash": 75,
  "gemini-2.5-pro": 53,
  "gemini-2.5-flash": 54,
  "gemini-2.5-flash-thinking": 55,
  "gemini-2.0-pro": 51,
  "gemini-2.0-flash": 52,
  "gemini-2.0-flash-thinking": 56,
};
const DEFAULT_MODEL_CATEGORY = 53;

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in (part as Record<string, unknown>)) {
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function extractCookieValue(cookie: string, name: string): string | null {
  for (const pair of cookie.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/** SAPISIDHASH auth header: SAPISIDHASH {epoch}_{sha1(epoch " " sapisid " " origin)}. */
function computeSapisidHash(sapisid: string, origin: string): string {
  const epoch = Math.floor(Date.now() / 1000);
  const hash = createHash("sha1").update(`${epoch} ${sapisid} ${origin}`).digest("hex");
  return `SAPISIDHASH ${epoch}_${hash}`;
}

/** Parses an enterprise entry URL (e.g. "business.gemini.google/home/cid/{CID}")
 * into the origin + path prefix the StreamGenerate URL is built from. */
function parseEntryUrl(entryUrl: string): { baseOrigin: string; pathPrefix: string } {
  const fallback = { baseOrigin: "https://business.gemini.google", pathPrefix: "/home" };
  const trimmed = entryUrl.trim();
  if (!trimmed) return fallback;
  const normalized = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(normalized);
    if (!u.host) return fallback;
    return { baseOrigin: `${u.protocol}//${u.host}`, pathPrefix: u.pathname.replace(/\/$/, "") || "/" };
  } catch {
    return fallback;
  }
}

/** Build the StreamGenerate inner array (80 protobuf-like slots). */
function buildInnerArray(prompt: string, modelCategory: number): unknown[] {
  const inner: unknown[] = new Array(80).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ["en"];
  inner[2] = ["", "", "", null, null, null, null, null, null, ""];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[0]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2];
  inner[53] = 0;
  inner[59] = crypto.randomUUID();
  inner[61] = [];
  inner[68] = 1;
  inner[79] = modelCategory;
  return inner;
}

/** Parse the `)]}'`-prefixed, byte-length-framed wrb.fr response into plain text. */
function parseStreamResponse(raw: string): string {
  const textChunks: string[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line === ")]}'" || /^\d+$/.test(line)) continue;
    if (!line.includes("wrb.fr")) continue;
    try {
      const arr = JSON.parse(line);
      if (!Array.isArray(arr) || !arr[0] || arr[0][0] !== "wrb.fr") continue;
      const payload = arr[0]?.[2];
      if (typeof payload !== "string") continue;
      const inner = JSON.parse(payload);
      const responseArray = inner?.[4]?.[0]?.[1];
      if (!Array.isArray(responseArray)) continue;
      const chunkText = responseArray.filter((c: unknown) => typeof c === "string").join("");
      if (chunkText) textChunks.push(chunkText);
    } catch {
      // Skip unparseable lines (binary chunks, etc.)
    }
  }
  return textChunks.join("");
}

function resolveCookie(credentials: Credentials): string {
  const direct = (credentials.apiKey || "").trim();
  if (direct) return direct;
  const psd = credentials.providerSpecificData as Record<string, unknown> | undefined;
  const psid = typeof psd?.["__Secure-1PSID"] === "string" ? (psd["__Secure-1PSID"] as string) : "";
  const psidts = typeof psd?.["__Secure-1PSIDTS"] === "string" ? (psd["__Secure-1PSIDTS"] as string) : "";
  return [psid, psidts].filter(Boolean).join("; ");
}

function buildStreamingResponse(text: string, model: string, cid: string, created: number) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null, logprobs: null }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
        choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
      })));
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  });
}

export class GeminiBusinessExecutor extends BaseExecutor {
  constructor() {
    super("gemini-business", PROVIDERS["gemini-business"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({ error: { message: "Missing or empty messages array", type: "invalid_request" } }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEFAULT_ENTRY_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const cookie = resolveCookie(credentials);
    if (!cookie) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing Gemini Business cookies. Set __Secure-1PSID and __Secure-1PSIDTS from your enterprise account (business.gemini.google).", type: "invalid_request", code: "missing_cookie" },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEFAULT_ENTRY_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const psd = credentials.providerSpecificData as Record<string, unknown> | undefined;
    const entryUrl = (typeof psd?.entryUrl === "string" && psd.entryUrl) || (typeof psd?.entry_url === "string" && psd.entry_url) || "https://business.gemini.google/home";
    const { baseOrigin, pathPrefix } = parseEntryUrl(entryUrl);

    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const prompt = extractTextContent(lastUserMsg?.content);
    if (!prompt) {
      const errResp = new Response(JSON.stringify({ error: { message: "No user message found in request body.", type: "invalid_request" } }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: DEFAULT_ENTRY_URL, headers: {} as Record<string, string>, transformedBody: body };
    }

    const modelCategory = MODEL_CATEGORY_MAP[model] ?? DEFAULT_MODEL_CATEGORY;
    const innerArray = buildInnerArray(prompt, modelCategory);
    const streamUrl = `${baseOrigin}${pathPrefix}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20240619.16_p0&hl=en&_reqid=${Math.floor(Math.random() * 900000) + 100000}&rt=c`;

    const formBody = new URLSearchParams();
    formBody.set("f.req", JSON.stringify([null, JSON.stringify(innerArray)]));

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookie,
      "X-Same-Domain": "1",
      "User-Agent": USER_AGENT,
      Origin: baseOrigin,
      Referer: `${baseOrigin}${pathPrefix}/`,
    };
    const sapisid = extractCookieValue(cookie, "SAPISID") || extractCookieValue(cookie, "__Secure-3PAPISID");
    if (sapisid) headers["Authorization"] = computeSapisidHash(sapisid, baseOrigin);

    log?.info?.("GEMINI-BUSINESS", `Query to ${model}, entry=${baseOrigin}${pathPrefix}`);

    let response: Response;
    try {
      response = await fetch(streamUrl, { method: "POST", headers, body: formBody.toString(), signal });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("GEMINI-BUSINESS", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({ error: { message: `Gemini Business connection failed: ${errMsg}`, type: "upstream_error" } }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: streamUrl, headers, transformedBody: { prompt } };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Gemini Business returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Gemini Business auth failed — cookies may be expired. Re-paste your __Secure-1PSID and __Secure-1PSIDTS cookies from business.gemini.google.";
      else if (status === 429) errMsg = "Gemini Business rate limited. Wait a moment and retry.";
      log?.warn?.("GEMINI-BUSINESS", errMsg);
      const errResp = new Response(JSON.stringify({ error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: streamUrl, headers, transformedBody: { prompt } };
    }

    const rawText = await response.text();

    if (rawText.includes("account-chooser")) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Gemini Business account-chooser detected. Your enterprise cookies may be stale or the entry URL is wrong. Re-extract __Secure-1PSID/PSIDTS from business.gemini.google/home/cid/{YOUR-CID} after signing in.", type: "upstream_error", code: "account_chooser" },
      }), { status: 403, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: streamUrl, headers, transformedBody: { prompt } };
    }

    const content = parseStreamResponse(rawText);
    if (!content) {
      const errResp = new Response(JSON.stringify({ error: { message: "Gemini Business returned no text. The cookie may be expired or the entry URL is wrong.", type: "upstream_error" } }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: streamUrl, headers, transformedBody: { prompt } };
    }

    const cid = `chatcmpl-gmb-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    const finalResponse = stream
      ? new Response(buildStreamingResponse(content, model, cid, created), { status: 200, headers: { ...SSE_HEADERS_NO_BUFFER } })
      : new Response(JSON.stringify({
          id: cid, object: "chat.completion", created, model, system_fingerprint: null,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null }],
          usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: Math.ceil((prompt.length + content.length) / 4) },
        }), { status: 200, headers: { "Content-Type": "application/json" } });

    return { response: finalResponse, url: streamUrl, headers, transformedBody: { prompt } };
  }
}

export default GeminiBusinessExecutor;
