// Zed hosted LLM aggregator — auth + model-catalog helpers.
//
// Zed's cloud (cloud.zed.dev) authenticates native apps with a self-generated RSA
// keypair instead of a registered OAuth client_id/secret:
//   1. Client generates an ephemeral RSA keypair.
//   2. Sends the public key to zed.dev/native_app_signin.
//   3. User signs in via browser; Zed redirects to a local callback with the
//      access token RSA-encrypted against the public key.
//   4. Client decrypts locally with the private key that never left the host.
// No embedded client_id/secret — the credential is a per-login keypair.

import crypto from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch";

const ZED_WEB_BASE_URL = "https://zed.dev";
const ZED_CLOUD_BASE_URL = "https://cloud.zed.dev";
const ZED_LLM_BASE_URL = "https://cloud.zed.dev";

export const ZED_HEADERS = {
  expiredToken: "x-zed-expired-token",
  outdatedToken: "x-zed-outdated-token",
  clientSupportsStatus: "x-zed-client-supports-status-messages",
  clientSupportsStreamEnded:
    "x-zed-client-supports-stream-ended-request-completion-status",
  serverSupportsStatus: "x-zed-server-supports-status-messages",
  clientSupportsXai: "x-zed-client-supports-x-ai",
  systemId: "x-zed-system-id",
};

const PRIVATE_KEY_PREFIX = "zed-rsa-pkcs1:";
const LLM_TOKEN_TTL_MS = 50 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

// Local interfaces for Zed credential/config shapes (ported from JS)
interface ZedCredentials {
  accessToken?: string;
  apiKey?: string;
  userId?: string;
  systemId?: string;
  providerSpecificData?: Record<string, unknown>;
}

interface ZedConfig {
  webBaseUrl?: string;
  cloudBaseUrl?: string;
  llmBaseUrl?: string;
  defaultNativeAppPort?: number;
}

interface ZedOptions {
  config?: ZedConfig;
  signal?: AbortSignal;
  organizationId?: string;
  forceRefresh?: boolean;
  nativeAppPort?: number;
  systemId?: string;
  fetchOptions?: Record<string, unknown>;
}

interface ZedError extends Error {
  status?: number;
  body?: unknown;
}

interface ZedLlmTokenCacheEntry {
  token: string;
  expiresAt: number;
}

interface ZedModelCacheEntry {
  expiresAt: number;
  models: ZedModelInfo[];
  rawModels: Record<string, unknown>[];
  rawById: Map<string, Record<string, unknown>>;
  defaultModel: string;
  defaultFastModel: string;
  recommendedModels: string[];
}

interface ZedModelInfo {
  id: string;
  name: string;
  provider: unknown;
  isLatest: boolean;
  contextLength: unknown;
  contextLengthInMaxMode: unknown;
  maxOutputTokens: unknown;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsThinking: boolean;
  supportsDisablingThinking: boolean;
  supportsFastMode: boolean;
  supportsServerSideCompaction: boolean;
  supportedEffortLevels: unknown;
  supportsStreamingTools: boolean;
  supportsParallelToolCalls: boolean;
  isDisabled: boolean;
  disabledReason: unknown;
}

const llmTokenCache = new Map<string, ZedLlmTokenCacheEntry>();
const modelCache = new Map<string, ZedModelCacheEntry>();
const modelInflight = new Map<string, Promise<ZedModelCacheEntry | null>>();

function b64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function b64urlPadded(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(value: string) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function normalizeBaseUrl(baseUrl: string | undefined, fallback: string) {
  return String(baseUrl || fallback).replace(/\/+$/, "");
}

function zedUrl(config: ZedConfig, key: keyof ZedConfig, path: string, fallbackBase: string) {
  const base = normalizeBaseUrl(config[key] as string | undefined, fallbackBase);
  return `${base}${path}`;
}

/** Encode a PEM private key as an opaque verifier (flows through the OAuth codeVerifier slot). */
function encodeZedPrivateKeyVerifier(privateKeyPem: string) {
  return `${PRIVATE_KEY_PREFIX}${b64url(privateKeyPem)}`;
}

function decodeZedPrivateKeyVerifier(verifier: string) {
  const value = String(verifier || "");
  if (!value.startsWith(PRIVATE_KEY_PREFIX)) {
    throw new Error("Missing Zed private key verifier; restart the login flow");
  }
  return fromB64url(value.slice(PRIVATE_KEY_PREFIX.length));
}

/** Generate a fresh RSA keypair + the zed.dev native_app_signin URL for it. */
export function createZedNativeAuthData(config: ZedConfig = {}, options: ZedOptions = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "der" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });

  const nativeAppPort = Number(
    options.nativeAppPort || config.defaultNativeAppPort || 58443,
  );
  const systemId = options.systemId || crypto.randomUUID();
  const publicKeyString = b64urlPadded(publicKey);
  const signInUrl = new URL(
    `${normalizeBaseUrl(config.webBaseUrl, ZED_WEB_BASE_URL)}/native_app_signin`,
  );
  signInUrl.searchParams.set("native_app_port", String(nativeAppPort));
  signInUrl.searchParams.set("native_app_public_key", publicKeyString);
  if (systemId) signInUrl.searchParams.set("system_id", systemId);

  return {
    authUrl: signInUrl.toString(),
    privateKeyVerifier: encodeZedPrivateKeyVerifier(privateKey),
    nativeAppPort,
    systemId,
    publicKey: publicKeyString,
  };
}

function parseRawCallbackInput(raw: string): Record<string, string> {
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(raw);
  } catch {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      try {
        url = new URL(`http://127.0.0.1/?${raw.replace(/^\?/, "")}`);
      } catch {
        throw new Error("Invalid Zed callback URL");
      }
    }
    url.searchParams.forEach((value, key) => {
      data[key] = value;
    });
  }
  return data;
}

/** Parse the pasted native-app callback URL/JSON/query into userId + encrypted token. */
export function parseZedCallbackPayload(input: string) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Missing Zed callback URL");

  const data = parseRawCallbackInput(raw);

  const userId = data.user_id || data.userId;
  const encryptedAccessToken = data.access_token || data.accessToken || data.token;
  if (!userId || !encryptedAccessToken) {
    throw new Error("Zed callback must include user_id and access_token");
  }
  return { userId: String(userId), encryptedAccessToken: String(encryptedAccessToken) };
}

/** Decrypt the RSA-encrypted access token using the stored private key. */
export function decryptZedAccessToken(encryptedAccessToken: string, privateKeyVerifier: string) {
  const privateKey = decodeZedPrivateKeyVerifier(privateKeyVerifier);
  const encrypted = Buffer.from(String(encryptedAccessToken), "base64url");
  try {
    return crypto
      .privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        encrypted,
      )
      .toString("utf8");
  } catch (oaepError) {
    try {
      return crypto
        .privateDecrypt(
          { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          encrypted,
        )
        .toString("utf8");
    } catch {
      const message = oaepError instanceof Error ? oaepError.message : String(oaepError);
      throw new Error(`Failed to decrypt Zed access token: ${message}`);
    }
  }
}

function buildZedUserAuthHeader(credentials: ZedCredentials) {
  const psd = credentials?.providerSpecificData || {};
  const userId = (psd.userId as string) || credentials?.userId;
  const accessToken = credentials?.accessToken || credentials?.apiKey;
  if (!userId || !accessToken) {
    throw new Error("Zed credential is missing userId or accessToken");
  }
  return `${userId} ${accessToken}`;
}

function getSystemId(credentials: ZedCredentials) {
  return String(
    credentials?.providerSpecificData?.systemId || credentials?.systemId || "",
  );
}

async function fetchJson(url: string, options: Record<string, unknown>) {
  const res = (await proxyAwareFetch(url, options)) as { text(): Promise<string>; ok: boolean; status: number; json(): Promise<unknown> };
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const message =
      (data as Record<string, unknown> | null)?.message ||
      ((data as Record<string, unknown> | null)?.error as Record<string, unknown> | undefined)?.message ||
      (data as Record<string, unknown> | null)?.error ||
      text ||
      `HTTP ${res.status}`;
    const err = new Error(String(message)) as ZedError;
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function fetchZedAuthenticatedUser(credentials: ZedCredentials, options: ZedOptions = {}) {
  const config = options.config || {};
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: buildZedUserAuthHeader(credentials),
  };
  const systemId = getSystemId(credentials);
  if (systemId) headers[ZED_HEADERS.systemId] = systemId;

  return fetchJson(zedUrl(config, "cloudBaseUrl", "/client/users/me", ZED_CLOUD_BASE_URL), {
    method: "GET",
    headers,
    signal: options.signal ?? undefined,
  });
}

function normalizeOrganizationId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (typeof (v as unknown as unknown[])[0] === "string") return (v as unknown as string[])[0];
    if (typeof v.id === "string") return v.id;
  }
  return String(value);
}

export function resolveZedOrganizationId(credentials: ZedCredentials, userInfo: Record<string, unknown> | null = null) {
  const psd = credentials?.providerSpecificData || {};
  const explicit = normalizeOrganizationId(psd.organizationId || psd.defaultOrganizationId);
  if (explicit) return explicit;
  const fromUser = normalizeOrganizationId(
    (userInfo as Record<string, unknown> | null)?.default_organization_id || (userInfo as Record<string, unknown> | null)?.defaultOrganizationId,
  );
  if (fromUser) return fromUser;
  const orgs = ((userInfo as Record<string, unknown> | null)?.organizations as Record<string, unknown>[]) || [];
  const org = orgs.find((item: Record<string, unknown>) => item?.is_personal) || orgs[0];
  return normalizeOrganizationId(org?.id);
}

function zedUserCacheKey(credentials: ZedCredentials, organizationId: string) {
  const psd = credentials?.providerSpecificData || {};
  const userId = (psd.userId as string) || credentials?.userId || "unknown";
  const token = credentials?.accessToken || credentials?.apiKey || "";
  return `${userId}:${organizationId || "default"}:${token.slice(-16)}`;
}

function zedModelCacheKey(credentials: ZedCredentials) {
  const psd = credentials?.providerSpecificData || {};
  const org = (psd.organizationId as string) || (psd.defaultOrganizationId as string) || "default";
  const token = credentials?.accessToken || credentials?.apiKey || "";
  return `${(psd.userId as string) || "unknown"}:${org}:${token.slice(-16)}`;
}

async function resolveOrgIdForToken(credentials: ZedCredentials, options: ZedOptions): Promise<string> {
  let organizationId = options.organizationId || resolveZedOrganizationId(credentials);
  if (!organizationId) {
    const userInfo = await fetchZedAuthenticatedUser(credentials, options);
    organizationId = resolveZedOrganizationId(credentials, userInfo as Record<string, unknown>);
  }
  if (!organizationId) throw new Error("No Zed organization selected");
  return organizationId;
}

function extractTokenFromResponse(data: Record<string, unknown> | null): string {
  const tokenVal = data?.token;
  const token =
    typeof tokenVal === "string" ? tokenVal :
    Array.isArray(tokenVal) ? (tokenVal[0] as string) :
    (tokenVal as Record<string, unknown> | undefined)?.value as string | undefined;
  if (!token) throw new Error("Zed did not return an LLM token");
  return token;
}

async function fetchZedLlmToken(credentials: ZedCredentials, options: ZedOptions = {}) {
  const config = options.config || {};
  const organizationId = await resolveOrgIdForToken(credentials, options);

  const cacheKey = zedUserCacheKey(credentials, organizationId);
  const cached = llmTokenCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: buildZedUserAuthHeader(credentials),
  };
  const systemId = getSystemId(credentials);
  if (systemId) headers[ZED_HEADERS.systemId] = systemId;

  const data = await fetchJson(
    zedUrl(config, "cloudBaseUrl", "/client/llm_tokens", ZED_CLOUD_BASE_URL),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ organization_id: organizationId }),
      signal: options.signal ?? undefined,
    },
  );
  const token = extractTokenFromResponse(data as Record<string, unknown> | null);
  llmTokenCache.set(cacheKey, { token, expiresAt: Date.now() + LLM_TOKEN_TTL_MS });
  return token;
}

function shouldRefreshZedLlmToken(response: { status?: number; headers?: { has?(name: string): boolean } }) {
  return (
    response?.status === 401 ||
    !!response?.headers?.has?.(ZED_HEADERS.expiredToken) ||
    !!response?.headers?.has?.(ZED_HEADERS.outdatedToken)
  );
}

export async function zedLlmFetch(credentials: ZedCredentials, path: string, options: ZedOptions = {}) {
  const config = options.config || {};
  const url = zedUrl(config, "llmBaseUrl", path, ZED_LLM_BASE_URL);
  const buildRequest = async (forceRefresh: boolean) => {
    const token = await fetchZedLlmToken(credentials, { ...options, forceRefresh });
    return proxyAwareFetch(url, {
      ...(options.fetchOptions || {}),
      headers: {
        ...((options.fetchOptions?.headers as Record<string, string>) || {}),
        Authorization: `Bearer ${token}`,
      },
      signal: options.signal ?? undefined,
    }) as Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;
  };

  let response = await buildRequest(false);
  if (shouldRefreshZedLlmToken(response)) {
    response = await buildRequest(true);
  }
  return response;
}

function normalizeZedModelId(id: unknown): string {
  if (!id) return "";
  if (typeof id === "string") return id;
  if (typeof id === "object" && id !== null) {
    const obj = id as Record<string, unknown>;
    if (typeof (obj as unknown as unknown[])[0] === "string") return (obj as unknown as string[])[0];
    if (typeof obj.id === "string") return obj.id;
  }
  return String(id);
}

function mapZedModel(model: Record<string, unknown>) {
  const id = normalizeZedModelId(model?.id);
  if (!id) return null;
  return {
    id,
    name: (model.display_name as string) || (model.displayName as string) || id,
    provider: model.provider,
    isLatest: !!model.is_latest,
    contextLength: model.max_token_count ?? model.maxTokenCount,
    contextLengthInMaxMode: model.max_token_count_in_max_mode ?? model.maxTokenCountInMaxMode,
    maxOutputTokens: model.max_output_tokens ?? model.maxOutputTokens,
    supportsTools: !!model.supports_tools,
    supportsImages: !!model.supports_images,
    supportsThinking: !!model.supports_thinking,
    supportsDisablingThinking: !!model.supports_disabling_thinking,
    supportsFastMode: !!model.supports_fast_mode,
    supportsServerSideCompaction: !!model.supports_server_side_compaction,
    supportedEffortLevels: model.supported_effort_levels ?? model.supportedEffortLevels ?? [],
    supportsStreamingTools: !!model.supports_streaming_tools,
    supportsParallelToolCalls: !!model.supports_parallel_tool_calls,
    isDisabled: !!model.is_disabled,
    disabledReason: model.disabled_reason ?? null,
  };
}

async function fetchAndCacheZedModels(
  credentials: ZedCredentials,
  options: ZedOptions,
  key: string,
): Promise<ZedModelCacheEntry | null> {
  const response = await zedLlmFetch(credentials, "/models", {
    ...options,
    fetchOptions: {
      method: "GET",
      headers: {
        Accept: "application/json",
        [ZED_HEADERS.clientSupportsXai]: "true",
      },
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Zed models failed: ${response.status} ${text}`);
  }
  const data = await response.json() as Record<string, unknown>;
  const rawModels = (Array.isArray(data?.models) ? data.models : []) as Record<string, unknown>[];
  const models = rawModels
    .map(mapZedModel)
    .filter((m): m is NonNullable<ReturnType<typeof mapZedModel>> => m !== null)
    .filter((model) => !model.isDisabled);
  const rawById = new Map<string, Record<string, unknown>>();
  for (const raw of rawModels) {
    const id = normalizeZedModelId(raw?.id);
    if (id) rawById.set(id, raw);
  }
  const entry: ZedModelCacheEntry = {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    models,
    rawModels,
    rawById,
    defaultModel: normalizeZedModelId(data?.default_model ?? data?.defaultModel),
    defaultFastModel: normalizeZedModelId(data?.default_fast_model ?? data?.defaultFastModel),
    recommendedModels: ((data?.recommended_models || data?.recommendedModels || []) as unknown[])
      .map(normalizeZedModelId)
      .filter(Boolean),
  };
  modelCache.set(key, entry);
  return entry;
}

/** Resolve (and cache) the live Zed model catalog. Never hardcoded — always a live fetch. */
export async function resolveZedModels(credentials: ZedCredentials, options: ZedOptions = {}) {
  if (!credentials?.accessToken) return null;
  const key = zedModelCacheKey(credentials);
  const cached = modelCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached;

  const existing = modelInflight.get(key);
  if (existing && !options.forceRefresh) return existing;

  const promise = fetchAndCacheZedModels(credentials, options, key);

  modelInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (modelInflight.get(key) === promise) modelInflight.delete(key);
  }
}

function clearZedCaches() {
  llmTokenCache.clear();
  modelCache.clear();
  modelInflight.clear();
}
