/**
 * Cursor live model catalog fetcher.
 *
 * Cursor exposes the account-specific model picker through the AgentService
 * `GetUsableModels` Connect RPC. Unlike the static provider registry, this
 * includes models newly enabled for the account and omits unavailable ones.
 */

import crypto from "crypto";
import http2 from "http2";
import { PROVIDER_OAUTH } from "../providers/index";
import { buildCursorHeaders } from "../utils/cursorChecksum";
import { decodeMessage } from "../utils/cursorProtobuf";
import type { Credentials } from "./types";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

// agent.v1.ModelDetails protobuf field numbers.
const MODEL_ID_FIELD = 1;
const DISPLAY_MODEL_ID_FIELD = 3;
const DISPLAY_NAME_FIELD = 4;
const DISPLAY_NAME_SHORT_FIELD = 5;
const RESPONSE_MODELS_FIELD = 1;

interface CatalogCacheEntry {
  expiresAt: number;
  models: { id: string; name: string }[];
}

/** @type {Map<string, { expiresAt: number, models: { id: string, name: string }[] }>} */
const catalogCache = new Map<string, CatalogCacheEntry>();

function getCursorModelsUrl(): string | null {
  const config = PROVIDER_OAUTH.cursor as Record<string, unknown> | undefined;
  if (!config?.agentEndpoint || !config?.modelsEndpoint) return null;
  return `${(config.agentEndpoint as string).replace(/\/$/, "")}${config.modelsEndpoint}`;
}

function cacheKey(credentials: Credentials): string {
  const seed = [
    credentials?.providerSpecificData?.machineId,
    credentials?.accessToken,
  ].filter(Boolean).join(":");
  if (!seed) return "cursor-anonymous";
  return crypto.createHash("sha256").update(`cursor:${seed}`).digest("hex");
}

interface ProtoField {
  wireType: number;
  value?: number;
  bytes?: Buffer;
}

interface ProtoMessage {
  get(fieldNumber: number): ProtoField[] | undefined;
}

function firstString(fields: ProtoMessage, fieldNumber: number): string {
  const value = fields.get(fieldNumber)?.[0]?.value;
  if (!value || typeof value === "number") return "";
  return Buffer.from(value as unknown as ArrayBuffer).toString("utf8");
}

/**
 * Decode Cursor's `agent.v1.GetUsableModelsResponse` protobuf payload.
 * The response contains repeated `agent.v1.ModelDetails` messages in field 1.
 */
function parseCursorUsableModels(payload: Uint8Array): { id: string; name: string }[] {
  const response = decodeMessage(payload) as ProtoMessage;
  const seen = new Set<string>();
  const models: { id: string; name: string }[] = [];

  for (const entry of response.get(RESPONSE_MODELS_FIELD) || []) {
    if (!entry?.value || typeof entry.value === "number") continue;
    const detail = decodeMessage(entry.value as unknown as Uint8Array) as ProtoMessage;
    const id = firstString(detail, MODEL_ID_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (
      firstString(detail, DISPLAY_NAME_FIELD)
      || firstString(detail, DISPLAY_NAME_SHORT_FIELD)
      || firstString(detail, DISPLAY_MODEL_ID_FIELD)
      || id
    ).trim();
    models.push({ id, name });
  }

  return models;
}

interface Http2Response {
  status: number;
  body: Buffer;
}

/**
 * agent.api5.cursor.sh is HTTP/2-only; Node fetch/undici cannot speak h2.
 * Unary GetUsableModels uses an unframed protobuf body (application/proto).
 */
function http2PostProto(url: string, headers: Record<string, string>, body: Uint8Array | null, signal: AbortSignal | null | undefined, timeoutMs: number): Promise<Http2Response> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`);
    const chunks: Buffer[] = [];
    let responseHeaders: Record<string, string | string[]> = {};
    let settled = false;

    const finish = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { client.close(); } catch {}
      fn(...args);
    };

    const timeoutId = setTimeout(finish(() => {
      reject(new Error("Cursor GetUsableModels timed out"));
    }), timeoutMs);

    client.on("error", finish(reject));

    const req = client.request({
      ":method": "POST",
      ":path": urlObj.pathname,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("response", (hdrs: Record<string, string | string[]>) => { responseHeaders = hdrs; });
    req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    req.on("end", finish(() => {
      resolve({
        status: Number(responseHeaders[":status"] || 0),
        body: Buffer.concat(chunks),
      });
    }));
    req.on("error", finish(reject));

    if (signal) {
      const onAbort = finish(() => reject(new Error("Request aborted")));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort as () => void, { once: true });
    }

    req.end(body && body.length ? Buffer.from(body) : undefined);
  });
}

async function fetchCursorCatalog(credentials: Credentials, signal?: AbortSignal | null): Promise<{ id: string; name: string }[] | null> {
  const accessToken = credentials?.accessToken;
  const machineId = credentials?.providerSpecificData?.machineId;
  const url = getCursorModelsUrl();
  if (!accessToken || !machineId || !url) return null;

  const headers: Record<string, string> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-scope: buildCursorHeaders is untyped
    ...buildCursorHeaders(accessToken, machineId as any, credentials?.providerSpecificData?.ghostMode !== false),
    // Connect unary calls use an unframed protobuf body, unlike Cursor chat's
    // streaming `application/connect+proto` endpoint.
    accept: "application/proto",
    "content-type": "application/proto",
  };
  delete headers["connect-accept-encoding"];
  delete headers["connect-protocol-version"];

  const response = await http2PostProto(url, headers, new Uint8Array(), signal, FETCH_TIMEOUT_MS);
  if (response.status !== 200) {
    const error = new Error(`Cursor GetUsableModels returned ${response.status}`);
    (error as Error & { status: number }).status = response.status;
    throw error;
  }

  return parseCursorUsableModels(new Uint8Array(response.body));
}

interface CursorModelsOptions {
  forceRefresh?: boolean;
  log?: { debug?: (tag: string, msg: string) => void; warn?: (tag: string, msg: string) => void };
  signal?: AbortSignal;
}

/**
 * Resolve the live Cursor catalog for the authenticated account.
 * Returns null on any failure so callers can fall back to static models.
 */
export async function resolveCursorModels(credentials: Credentials, options: CursorModelsOptions = {}): Promise<{ models: { id: string; name: string }[] } | null> {
  if (!credentials?.accessToken || !credentials?.providerSpecificData?.machineId) {
    options.log?.debug?.("CURSOR_MODELS", "No Cursor access token or machine ID; skipping live fetch");
    return null;
  }

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) return { models: cached.models };
  }

  try {
    const models = await fetchCursorCatalog(credentials, options.signal);
    if (!models?.length) return null;
    catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
    return { models };
  } catch (error: unknown) {
    options.log?.warn?.("CURSOR_MODELS", `Live model fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function clearCursorModelCache(): void {
  catalogCache.clear();
}
