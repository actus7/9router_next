import { createHash } from "crypto";

import { proxyAwareFetch } from "../utils/proxyFetch";
import type { Credentials } from "./types";

export const KIMCHI_API = "https://llm.kimchi.dev";
export const KIMCHI_USER_AGENT = "kimchi/0.1.40";

const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

interface KimchiModel {
  id: string;
  name: string;
  provider: string;
  upstreamProvider: string;
  reasoning: boolean;
  inputModalities: string[];
  kind: string;
  type: string;
  capabilities: Record<string, unknown>;
  contextLength?: number;
  maxOutputTokens?: number;
  compat?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CatalogCacheEntry {
  expiresAt: number;
  models: KimchiModel[];
  rawModels: Record<string, unknown>[];
}

/** @type {Map<string, { expiresAt: number, models: object[], rawModels: object[] }>} */
const catalogCache = new Map<string, CatalogCacheEntry>();
/** @type {Map<string, object>} */
const metadataByModelId = new Map<string, KimchiModel>();

function normalizeKimchiEndpoint(endpoint: unknown): string {
  const raw = typeof endpoint === "string" ? endpoint.trim() : "";
  return (raw || KIMCHI_API).replace(/\/+$/, "");
}

export function buildKimchiModelsUrl(endpoint: unknown): string {
  return `${normalizeKimchiEndpoint(endpoint)}/v1/models/metadata?include_in_cli=true`;
}

function readToken(credentials: Credentials): string | null {
  return (
    credentials?.accessToken
    || credentials?.apiKey
    || (credentials?.providerSpecificData?.apiKey as string)
    || null
  );
}

function cacheKey(credentials: Credentials, endpoint: unknown): string {
  const psd = credentials?.providerSpecificData || {};
  const seed = (psd.userId || psd.username || credentials?.refreshToken || readToken(credentials) || "anonymous") as string;
  return createHash("sha256")
    .update(`kimchi:${normalizeKimchiEndpoint(endpoint)}:${seed}`)
    .digest("hex");
}

function toModelKind(inputModalities: unknown): string {
  return Array.isArray(inputModalities) && inputModalities.includes("image")
    ? "imageToText"
    : "llm";
}

export function normalizeKimchiModel(item: unknown): KimchiModel | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  const id = (obj.slug || obj.id || obj.model || obj.name) as string | undefined;
  if (typeof id !== "string" || id.trim() === "") return null;

  const inputModalities = Array.isArray(obj.input_modalities)
    ? (obj.input_modalities as unknown[]).filter((value: unknown) => value === "text" || value === "image") as string[]
    : [];
  const limits = obj.limits && typeof obj.limits === "object" ? obj.limits as Record<string, unknown> : {};
  const contextLength = Number(limits.context_window || obj.contextLength || obj.context_length) || undefined;
  const maxOutputTokens = Number(limits.max_output_tokens || obj.maxOutputTokens || obj.max_output_tokens) || undefined;
  const upstreamProvider = typeof obj.provider === "string" ? obj.provider : "";
  const reasoning = obj.reasoning === true;
  const kind = toModelKind(inputModalities);

  const model: KimchiModel = {
    ...obj,
    id: id.trim(),
    name: String(obj.display_name || obj.displayName || obj.name || id).trim(),
    provider: upstreamProvider,
    upstreamProvider,
    reasoning,
    inputModalities,
    kind,
    type: kind,
    capabilities: {
      vision: inputModalities.includes("image"),
      reasoning,
      ...(contextLength ? { contextWindow: contextLength } : {}),
      ...(maxOutputTokens ? { maxOutput: maxOutputTokens } : {}),
      ...(upstreamProvider ? { upstreamProvider } : {}),
    },
    ...(contextLength ? { contextLength } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };

  if (upstreamProvider === "anthropic") {
    model.compat = { supportsReasoningEffort: false, cacheControlFormat: "anthropic" };
  }

  return model;
}

function rememberModels(models: KimchiModel[]): void {
  for (const model of models || []) {
    if (!model?.id) continue;
    metadataByModelId.set(model.id, model);
    metadataByModelId.set(model.id.toLowerCase(), model);
  }
}

export function getCachedKimchiModelMetadata(modelId: unknown): KimchiModel | null {
  if (typeof modelId !== "string" || modelId.trim() === "") return null;
  const raw = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  return metadataByModelId.get(raw) || metadataByModelId.get(raw.toLowerCase()) || null;
}

interface KimchiFetchError extends Error {
  status?: number;
  retryable?: boolean;
}

async function fetchKimchiCatalogRaw(token: string, endpoint: unknown, options: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  const url = buildKimchiModelsUrl(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Kimchi models fetch timeout")), FETCH_TIMEOUT_MS);
  const signal = (options.signal as AbortSignal | undefined)
    ? AbortSignal.any([options.signal as AbortSignal, controller.signal])
    : controller.signal;

  try {
    const response = await proxyAwareFetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": KIMCHI_USER_AGENT,
      },
      cache: "no-store",
      signal,
    }, (options.proxyOptions ?? null) as null) as Response;

    if (!response.ok) {
      const error: KimchiFetchError = new Error(`Kimchi models ${response.status}: ${response.statusText}`);
      error.status = response.status;
      error.retryable = RETRYABLE_STATUSES.has(response.status);
      throw error;
    }

    const data = await response.json();
    return Array.isArray(data?.models) ? data.models : [];
  } finally {
    clearTimeout(timeout);
  }
}

interface KimchiModelsOptions {
  forceRefresh?: boolean;
  log?: { warn?: (tag: string, msg: string) => void };
  signal?: AbortSignal;
  proxyOptions?: unknown;
  endpoint?: string;
}

export async function resolveKimchiModels(credentials: Credentials, options: KimchiModelsOptions = {}): Promise<CatalogCacheEntry | null> {
  const token = readToken(credentials);
  if (!token) return null;

  const endpoint = credentials?.providerSpecificData?.kimchiEndpoint || options.endpoint || KIMCHI_API;
  const key = cacheKey(credentials, endpoint);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) return cached;
  }

  let rawModels: Record<string, unknown>[];
  try {
    rawModels = await fetchKimchiCatalogRaw(token, endpoint, options as Record<string, unknown>);
  } catch (error: unknown) {
    options.log?.warn?.("KIMCHI_MODELS", error instanceof Error ? error.message : String(error));
    return null;
  }

  const models = rawModels.map(normalizeKimchiModel).filter((m): m is KimchiModel => m !== null);
  if (models.length === 0) return null;

  rememberModels(models);
  const entry: CatalogCacheEntry = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    models,
    rawModels,
  };
  catalogCache.set(key, entry);
  return entry;
}

export function clearKimchiCatalog(): void {
  catalogCache.clear();
  metadataByModelId.clear();
}
