import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { createHash } from "crypto";
import os from "os";
import type { Credentials, Logger } from "../services/types";

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";
const CHAT_URL = PROVIDERS["mimo-free"].baseUrl as string;
const SESSION_AFFINITY_PREFIX = "ses_";
const SESSION_ID_LENGTH = 24;
const JWT_FALLBACK_TTL_SEC = 3000;
const JWT_EXPIRY_BUFFER_MS = 300000;
const SESSION_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Anti-abuse gate: upstream rejects requests without a Chrome-like User-Agent with 403 "Illegal access"
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

// Anti-abuse gate marker: the free chat endpoint returns 403 "Illegal access"
// unless a system message contains this exact MiMoCode signature substring.
const MIMO_SYSTEM_MARKER =
  "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";

// In-memory JWT cache (per-process, survives across requests but not restarts)
let cachedJwt: string | null = null;
let jwtExpiresAt = 0;

// Device fingerprint reused as the bootstrap "client" — stable per machine
function generateFingerprint() {
  let username = "unknown-user";
  try {
    username = os.userInfo().username;
  } catch {
    // ignore
  }
  const cpu = (os.cpus()[0]?.model || "unknown-cpu").trim();
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpu}|${username}`;
  return createHash("sha256").update(seed).digest("hex");
}

function generateSessionId() {
  let id = SESSION_AFFINITY_PREFIX;
  for (let i = 0; i < SESSION_ID_LENGTH; i++) {
    id += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)];
  }
  return id;
}

// Derive expiry from the JWT exp claim; fall back to a fixed TTL when unparseable
function parseJwtExp(jwt: string) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString()) as Record<string, unknown>;
    if (payload.exp) return (payload.exp as number) * 1000;
  } catch {
    // ignore
  }
  return Date.now() + JWT_FALLBACK_TTL_SEC * 1000;
}

// Ensure the body carries the anti-abuse marker in a system message (idempotent)
function injectSystemMarker(body: Record<string, unknown>) {
  const messages = body?.messages as Record<string, unknown>[] | undefined;
  if (!Array.isArray(messages)) return body;
  const hasMarker = messages.some(
    (m) => m?.role === "system" && typeof m.content === "string" && m.content.includes(MIMO_SYSTEM_MARKER)
  );
  if (hasMarker) return body;
  return { ...body, messages: [{ role: "system", content: MIMO_SYSTEM_MARKER }, ...messages] };
}

function resetJwtCache() {
  cachedJwt = null;
  jwtExpiresAt = 0;
}

async function bootstrapJwt(proxyOptions: unknown = null) {
  if (cachedJwt && Date.now() < jwtExpiresAt - JWT_EXPIRY_BUFFER_MS) {
    return cachedJwt;
  }

  const response = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    },
    body: JSON.stringify({ client: generateFingerprint() }),
  }, proxyOptions as null);

  if (!response.ok) {
    throw new Error(`MiMo bootstrap failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  if (!data.jwt) {
    throw new Error("MiMo bootstrap returned no JWT");
  }

  cachedJwt = data.jwt as string;
  jwtExpiresAt = parseJwtExp(data.jwt as string);
  return cachedJwt;
}

export class MimoFreeExecutor extends BaseExecutor {
  sessionId: string;

  constructor() {
    super("mimo-free", PROVIDERS["mimo-free"]);
    this.sessionId = generateSessionId();
  }

  buildUrl() {
    return CHAT_URL;
  }

  buildHeaders(credentials: Credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "X-Mimo-Source": "mimocode-cli-free",
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      "x-session-affinity": this.sessionId,
      "Accept": stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(model: string, body: Record<string, unknown>) {
    return injectSystemMarker(body);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger; proxyOptions?: unknown }) {
    let jwt: string;
    try {
      jwt = await bootstrapJwt(proxyOptions);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log?.error?.("AUTH", `MiMo bootstrap failed: ${errMsg}`);
      throw error;
    }

    const url = this.buildUrl();
    const transformedBody = this.transformRequest(model, body);
    const headers = { ...this.buildHeaders(credentials, stream), "Authorization": `Bearer ${jwt}` };
    const bodyStr = JSON.stringify(transformedBody);
    log?.debug?.("FETCH", `MIMO-FREE → ${url} | body=${bodyStr.length}B`);

    const response = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions as null);

    // On auth failure, invalidate cache and retry once with a fresh JWT
    if (response.status === 401 || response.status === 403) {
      log?.debug?.("AUTH", `MiMo auth failed (${response.status}), re-bootstrapping...`);
      resetJwtCache();
      jwt = await bootstrapJwt(proxyOptions);
      headers["Authorization"] = `Bearer ${jwt}`;
      const retryResponse = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions as null);
      return { response: retryResponse, url, headers, transformedBody };
    }

    return { response, url, headers, transformedBody };
  }
}


export default MimoFreeExecutor;
