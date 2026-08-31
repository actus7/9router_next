import { getProviderConnectionById, updateProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getDefaultModel, PROVIDERS } from "@/server/llm-gateway/catalog";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
  buildClineHeaders,
} from "@/server/llm-gateway/auth";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  KIRO_CONFIG,
  CLAUDE_CONFIG,
  CLINE_CONFIG,
  KILOCODE_CONFIG,
  KIMCHI_CONFIG,
} from "@/lib/oauth/constants/oauth";

interface OAuthTestConfig {
  url?: string;
  method?: string;
  authHeader?: string;
  authPrefix?: string;
  extraHeaders?: Record<string, string>;
  body?: string;
  acceptStatuses?: number[];
  refreshable?: boolean;
  checkExpiry?: boolean;
  tokenExists?: boolean;
  noAuth?: boolean;
  buildUrl?: (token: string) => string;
  softFailMessage?: Record<number, string>;
}

interface ProbeResult {
  valid: boolean;
  error: string | null;
  soft: boolean;
}

interface TestResult {
  valid: boolean;
  error: string | null;
  refreshed?: boolean;
  newTokens?: Record<string, unknown> | null;
  warning?: string | null;
}

interface SingleTestResult {
  valid: boolean;
  error: string | null;
  refreshed: boolean;
  latencyMs: number;
  testedAt: string;
  diagnosis?: Record<string, unknown>;
  statusCode?: number;
}

interface ConnectionProxyConfig {
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
  vercelRelayUrl?: string;
  strictProxy?: boolean;
}

const KILO_GATEWAY_MODELS_URL = "https://api.kilo.ai/api/gateway/models";
const API_AIRFORCE_MODELS_URL = "https://api.airforce/v1/models";

// OAuth provider test endpoints
const OAUTH_TEST_CONFIG: Record<string, OAuthTestConfig> = {
  claude: { checkExpiry: true, refreshable: true },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/responses",
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json", "originator": "codex_cli_rs", "User-Agent": "codex_cli_rs/0.136.0" },
    body: JSON.stringify({ model: "gpt-5.3-codex", input: [], stream: false, store: false }),
    acceptStatuses: [400],
    refreshable: true,
  },
  "gemini-cli": {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  github: {
    url: "https://api.github.com/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "User-Agent": "ModelHub", "Accept": "application/vnd.github+json" },
  },
  iflow: {
    buildUrl: (token: string) => `https://iflow.cn/api/oauth/getUserInfo?accessToken=${encodeURIComponent(token)}`,
    method: "GET",
    noAuth: true,
  },
  kiro: { checkExpiry: true, refreshable: true },
  qoder: {
    url: "https://openapi.qoder.sh/api/v1/userinfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: false,
  },
  kimi: { checkExpiry: true, refreshable: true },
  "kimi-coding": { checkExpiry: true, refreshable: true },
  cursor: { tokenExists: true },
  kilocode: {
    url: `${KILOCODE_CONFIG.apiBaseUrl}/api/profile`,
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  cline: { refreshable: true },
  gitlab: {
    url: "https://gitlab.com/api/v4/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  "codebuddy-cn": { tokenExists: true },
  kimchi: {
    url: (KIMCHI_CONFIG.validationUrl as string) || "https://api.cast.ai/v1/llm/openai/supported-providers",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      "User-Agent": "kimchi/0.1.40",
    },
    refreshable: false,
  },
  "grok-cli": {
    url: (PROVIDERS["grok-cli"]?.userUrl as string) || "https://cli-chat-proxy.grok.com/v1/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      ...(PROVIDERS["grok-cli"]?.headers || {
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-identifier": "grok-pager",
        "x-grok-client-version": "0.2.93",
      }),
    },
    refreshable: true,
    acceptStatuses: [402],
    softFailMessage: {
      402: "Connected, but Grok Build credits are exhausted (spending limit). Add credits or upgrade SuperGrok.",
    },
  },
};

/**
 * Classify an OAuth probe response as success / soft-success / hard-fail.
 * Soft success (e.g. 402 spending-limit on Grok CLI) means auth works but the
 * account cannot spend — keep connection active and surface a warning.
 * Exported for unit tests.
 */
function classifyOAuthProbeResult(res: Response | null, config: OAuthTestConfig | null, bodyText = ""): ProbeResult {
  if (!res) return { valid: false, error: "No response", soft: false };
  const status = res.status;
  const accepted = res.ok || (config?.acceptStatuses && config.acceptStatuses.includes(status));
  if (!accepted) {
    if (status === 401) return { valid: false, error: "Token invalid or revoked", soft: false };
    if (status === 403) return { valid: false, error: "Access denied", soft: false };
    return { valid: false, error: `API returned ${status}`, soft: false };
  }

  if (!res.ok && config?.acceptStatuses?.includes(status)) {
    const softMap = config.softFailMessage || {};
    if (softMap[status]) {
      return { valid: true, error: softMap[status], soft: true };
    }
    return { valid: true, error: null, soft: false };
  }

  return { valid: true, error: null, soft: false };
}

async function probeClineAccessToken(accessToken: string): Promise<Response> {
  const res = await fetch("https://api.cline.bot/api/v1/users/me", {
    method: "GET",
    headers: buildClineHeaders(accessToken, {
      Accept: "application/json",
    }),
  });

  return res;
}

const CLOUD_CODE_ASSIST_TEST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLOUD_CODE_ASSIST_TEST_BODY = JSON.stringify({
  metadata: {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  },
});

function parseProviderErrorMessage(bodyText: string, fallback: string): string {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    const message = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message) return JSON.stringify(message);
  } catch {
    // fall through
  }
  return bodyText.trim() || fallback;
}

async function probeCloudCodeAssistAccess(connection: Record<string, unknown>, accessToken: string, effectiveProxy: ConnectionProxyConfig | null = null): Promise<{ valid: boolean; error: string | null; status?: number }> {
  const userAgent = connection.provider === "antigravity"
    ? "google-api-nodejs-client/9.15.1 vscode-antigravity/1.107.0"
    : "google-api-nodejs-client/9.15.1 gemini-cli/0.34.0";

  const res = await fetchWithConnectionProxy(CLOUD_CODE_ASSIST_TEST_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: CLOUD_CODE_ASSIST_TEST_BODY,
  }, effectiveProxy);

  if (res.ok) return { valid: true, error: null };

  const bodyText = await res.text().catch(() => "");
  return {
    valid: false,
    error: parseProviderErrorMessage(bodyText, `API returned ${res.status}`),
    status: res.status,
  };
}

async function refreshOAuthToken(connection: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const provider = connection.provider as string;
  const refreshToken = connection.refreshToken as string;
  if (!refreshToken) return null;

  try {
    if (provider === "gemini-cli" || provider === "antigravity") {
      const config = provider === "gemini-cli" ? GEMINI_CONFIG : ANTIGRAVITY_CONFIG;
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId as string,
          client_secret: config.clientSecret as string,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "codex" || provider === "grok-cli" || provider === "xai") {
      return await refreshProviderCredentials(provider, connection, console);
    }

    if (provider === "claude") {
      const response = await fetch(CLAUDE_CONFIG.tokenUrl as string, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLAUDE_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "kiro") {
      const psd = (connection.providerSpecificData || {}) as Record<string, unknown>;
      const clientId = psd.clientId || connection.clientId;
      const clientSecret = psd.clientSecret || connection.clientSecret;
      const region = psd.region || connection.region;
      if (clientId && clientSecret) {
        const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, clientSecret, refreshToken, grantType: "refresh_token" }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return { accessToken: data.accessToken, expiresIn: data.expiresIn || 3600, refreshToken: data.refreshToken || refreshToken };
      }
      const response = await fetch(KIRO_CONFIG.socialRefreshUrl as string, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "kiro-cli/1.0.0" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.accessToken, expiresIn: data.expiresIn || 3600, refreshToken: data.refreshToken || refreshToken };
    }

    if (provider === "cline") {
      const response = await fetch(CLINE_CONFIG.refreshUrl as string, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          refreshToken,
          grantType: "refresh_token",
          clientType: "extension",
        }),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const data = payload?.data || payload;
      const expiresIn = data?.expiresAt
        ? Math.max(1, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000))
        : 3600;
      return {
        accessToken: data?.accessToken,
        expiresIn,
        refreshToken: data?.refreshToken || refreshToken,
      };
    }

    return null;
  } catch (err) {
    console.error(`Error refreshing ${provider} token:`, (err as Error).message);
    return null;
  }
}

function isTokenExpired(connection: Record<string, unknown>): boolean {
  return shouldRefreshCredentials(connection.provider as string, connection);
}

async function testOAuthConnection(connection: Record<string, unknown>, effectiveProxy: ConnectionProxyConfig | null = null): Promise<TestResult> {
  const config = OAUTH_TEST_CONFIG[connection.provider as string];
  if (!config) return { valid: false, error: "Provider test not supported", refreshed: false };
  if (!connection.accessToken) return { valid: false, error: "No access token", refreshed: false };

  if (config.tokenExists) {
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  let accessToken = connection.accessToken as string;
  let refreshed = false;
  let newTokens: Record<string, unknown> | null = null;

  const tokenExpired = isTokenExpired(connection);
  if (config.refreshable && tokenExpired && connection.refreshToken) {
    const tokens = await refreshOAuthToken(connection);
    if (tokens) {
      accessToken = tokens.accessToken as string;
      refreshed = true;
      newTokens = tokens;
    } else {
      return { valid: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  if (config.checkExpiry) {
    if (refreshed) return { valid: true, error: null, refreshed, newTokens };
    if (tokenExpired) return { valid: false, error: "Token expired", refreshed: false };
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  if (connection.provider === "gemini-cli" || connection.provider === "antigravity") {
    const initial = await probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy);
    if (initial.valid) return { valid: true, error: null, refreshed, newTokens };

    if (initial.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens?.accessToken) {
        const retry = await probeCloudCodeAssistAccess(connection, tokens.accessToken as string, effectiveProxy);
        if (retry.valid) return { valid: true, error: null, refreshed: true, newTokens: tokens };
        return { valid: false, error: retry.error, refreshed: true, newTokens: tokens };
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: initial.error, refreshed };
  }

  if (connection.provider === "cline") {
    const tryProbe = async (token: string): Promise<TestResult> => {
      const res = await probeClineAccessToken(token);
      if (res.ok) return { valid: true, error: null, refreshed, newTokens };
      if (res.status === 401) return { valid: false, error: "Token invalid or revoked", refreshed };
      if (res.status === 403) return { valid: false, error: "Access denied", refreshed };
      return { valid: false, error: `API returned ${res.status}`, refreshed };
    };

    const initial = await tryProbe(accessToken);
    if (initial.valid || initial.error !== "Token invalid or revoked" || !connection.refreshToken) {
      return initial;
    }

    const tokens = await refreshOAuthToken(connection);
    if (!tokens?.accessToken) {
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    refreshed = true;
    newTokens = tokens;
    accessToken = tokens.accessToken as string;
    return await tryProbe(accessToken);
  }

  try {
    const testUrl = config.buildUrl ? config.buildUrl(accessToken) : config.url!;
    const headers = config.noAuth
      ? { ...config.extraHeaders }
      : { [config.authHeader!]: `${config.authPrefix}${accessToken}`, ...config.extraHeaders };
    const fetchOpts: RequestInit = { method: config.method, headers };
    if (config.body) fetchOpts.body = config.body;
    const res = await fetchWithConnectionProxy(testUrl, fetchOpts, effectiveProxy);
    const bodyText = !res.ok ? await res.text().catch(() => "") : "";

    const classified = classifyOAuthProbeResult(res, config, bodyText);
    if (classified.valid) {
      return {
        valid: true,
        error: classified.soft ? classified.error : null,
        warning: classified.soft ? classified.error : null,
        refreshed,
        newTokens,
      };
    }

    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens) {
        const retryUrl = config.buildUrl ? config.buildUrl(tokens.accessToken as string) : testUrl;
        const retryHeaders = config.noAuth
          ? { ...config.extraHeaders }
          : { [config.authHeader!]: `${config.authPrefix}${tokens.accessToken}`, ...config.extraHeaders };
        const retryOpts: RequestInit = { method: config.method, headers: retryHeaders };
        if (config.body) retryOpts.body = config.body;
        const retryRes = await fetchWithConnectionProxy(retryUrl, retryOpts, effectiveProxy);
        const retryBody = !retryRes.ok ? await retryRes.text().catch(() => "") : "";
        const retryClassified = classifyOAuthProbeResult(retryRes, config, retryBody);
        if (retryClassified.valid) {
          return {
            valid: true,
            error: retryClassified.soft ? retryClassified.error : null,
            warning: retryClassified.soft ? retryClassified.error : null,
            refreshed: true,
            newTokens: tokens,
          };
        }
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: classified.error, refreshed };
  } catch (err) {
    return { valid: false, error: (err as Error).message, refreshed };
  }
}

async function fetchWithConnectionProxy(url: string, options: RequestInit = {}, effectiveProxy: ConnectionProxyConfig | null = null): Promise<Response> {
  if (effectiveProxy?.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
    return proxyAwareFetch(url, options, {
      vercelRelayUrl: effectiveProxy.vercelRelayUrl,
    });
  }

  if (!effectiveProxy?.connectionProxyEnabled || !effectiveProxy?.connectionProxyUrl) {
    return fetch(url, options);
  }

  const { proxyAwareFetch } = await import("@/server/llm-gateway/usage");
  return proxyAwareFetch(url, options, {
    connectionProxyEnabled: true,
    connectionProxyUrl: effectiveProxy.connectionProxyUrl,
    connectionNoProxy: effectiveProxy.connectionNoProxy || "",
  });
}

// Kilo documents its models endpoint as public. Probe it with the configured
// key so this connection has a real gateway reachability check without making
// a billable completion; key authorization is enforced on completion requests.
export async function testKiloGatewayConnection(apiKey: unknown, effectiveProxy: ConnectionProxyConfig | null = null): Promise<TestResult> {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return { valid: false, error: "Missing API key", refreshed: false };
  }

  try {
    const res = await fetchWithConnectionProxy(KILO_GATEWAY_MODELS_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    }, effectiveProxy);
    return {
      valid: res.ok,
      error: res.ok ? null : `Kilo Gateway models request failed (${res.status})`,
      refreshed: false,
    };
  } catch (err) {
    return { valid: false, error: (err as Error).message, refreshed: false };
  }
}

export async function testApiAirforceConnection(apiKey: unknown, effectiveProxy: ConnectionProxyConfig | null = null): Promise<TestResult> {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return { valid: false, error: "Missing API key", refreshed: false };
  }

  try {
    const res = await fetchWithConnectionProxy(API_AIRFORCE_MODELS_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://endpoint-proxy.local",
        "X-Title": "Endpoint Proxy",
      },
    }, effectiveProxy);
    return {
      valid: res.ok,
      error: res.ok ? null : `Api Airforce models request failed (${res.status})`,
      refreshed: false,
    };
  } catch (err) {
    return { valid: false, error: (err as Error).message, refreshed: false };
  }
}

// ── Provider-family helpers for testApiKeyConnection ──────────────────────

/** Probe a URL with Bearer auth; success = res.ok. */
async function probeBearerGet(url: string, apiKey: string, proxy: ConnectionProxyConfig | null, errorMsg = "Invalid API key"): Promise<TestResult> {
  const res = await fetchWithConnectionProxy(url, { headers: { Authorization: `Bearer ${apiKey}` } }, proxy);
  return { valid: res.ok, error: res.ok ? null : errorMsg, refreshed: false };
}

/** Anthropic-style POST /v1/messages with x-api-key + anthropic-version. */
async function probeAnthropicStyle(url: string, apiKey: string, model: string, proxy: ConnectionProxyConfig | null, alsoReject403 = true): Promise<TestResult> {
  const res = await fetchWithConnectionProxy(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
  }, proxy);
  const valid = alsoReject403 ? (res.status !== 401 && res.status !== 403) : (res.status !== 401);
  return { valid, error: valid ? null : "Invalid API key" };
}

/** POST /chat/completions with caller-supplied headers and body. */
async function probeChatCompletions(
  url: string, headers: Record<string, string>, body: Record<string, unknown>,
  proxy: ConnectionProxyConfig | null, errorMsg = "Invalid API key", rejectStatuses: number[] = [401, 403],
): Promise<TestResult> {
  const res = await fetchWithConnectionProxy(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, proxy);
  const valid = !rejectStatuses.includes(res.status);
  return { valid, error: valid ? null : errorMsg };
}

// Lookup tables ───────────────────────────────────────────────────────────

/** GET /models (or equivalent) with Bearer auth, validated via res.ok. */
const SIMPLE_BEARER_MODELS: Record<string, string> = {
  openai: "https://api.openai.com/v1/models",
  "vercel-ai-gateway": "https://ai-gateway.vercel.sh/v1/models",
  deepseek: "https://api.deepseek.com/models",
  groq: "https://api.groq.com/openai/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
  xai: "https://api.x.ai/v1/models",
  nvidia: "https://integrate.api.nvidia.com/v1/models",
  perplexity: "https://api.perplexity.ai/v1/models",
  together: "https://api.together.xyz/v1/models",
  fireworks: "https://api.fireworks.ai/inference/v1/models",
  cerebras: "https://api.cerebras.ai/v1/models",
  cohere: "https://api.cohere.ai/v1/models",
  nebius: "https://api.studio.nebius.ai/v1/models",
  siliconflow: "https://api.siliconflow.com/v1/models",
  hyperbolic: "https://api.hyperbolic.xyz/v1/models",
  nanobanana: "https://api.nanobananaapi.ai/v1/models",
  chutes: "https://llm.chutes.ai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/auth/key",
  assemblyai: "https://api.assemblyai.com/v1/account",
};

const XIAOMI_MODELS_URLS: Record<string, string> = {
  "xiaomi-mimo": "https://api.xiaomimimo.com/v1/models",
  "xiaomi-tokenplan": "https://token-plan-sgp.xiaomimimo.com/v1/models",
};

/** POST /v1/messages with x-api-key. anthropic only rejects 401 (not 403). */
const ANTHROPIC_STYLE_PROBES: Record<string, { url: string; model: string; alsoReject403?: boolean }> = {
  anthropic: { url: "https://api.anthropic.com/v1/messages", model: "claude-3-haiku-20240307", alsoReject403: false },
  glm: { url: "https://api.z.ai/api/anthropic/v1/messages", model: "glm-4.7" },
  minimax: { url: "https://api.minimax.io/anthropic/v1/messages", model: "minimax-m2" },
  "minimax-cn": { url: "https://api.minimaxi.com/anthropic/v1/messages", model: "minimax-m2" },
  kimi: { url: "https://api.kimi.com/coding/v1/messages", model: "kimi-latest" },
};

/** GET with non-Bearer auth prefix (Token / Key) or no-proxy requirement. */
const CUSTOM_AUTH_PROBES: Record<string, { url: string; authPrefix: string; rejectStatuses?: number[]; noProxy?: boolean }> = {
  ollama: { url: "https://ollama.com/api/tags", authPrefix: "Bearer ", noProxy: true },
  deepgram: { url: "https://api.deepgram.com/v1/projects", authPrefix: "Token " },
  "fal-ai": { url: "https://api.fal.ai/v1/models?limit=1", authPrefix: "Key ", rejectStatuses: [401, 403] },
};

async function probeCustomAuth(url: string, authHeader: string, proxy: ConnectionProxyConfig | null, rejectStatuses?: number[], noProxy?: boolean): Promise<TestResult> {
  const init: RequestInit = { headers: { Authorization: authHeader } };
  const res = noProxy ? await fetch(url, init) : await fetchWithConnectionProxy(url, init, proxy);
  const valid = rejectStatuses ? !rejectStatuses.includes(res.status) : res.ok;
  return { valid, error: valid ? null : "Invalid API key", refreshed: false };
}

// ── Entry point ──────────────────────────────────────────────────────────

async function testApiKeyConnection(connection: Record<string, unknown>, effectiveProxy: ConnectionProxyConfig | null = null): Promise<TestResult> {
  const provider = connection.provider as string;
  const apiKey = connection.apiKey as string;
  const psd = (connection.providerSpecificData || {}) as Record<string, unknown>;

  // OpenAI-compatible custom base: GET /models
  if (isOpenAICompatibleProvider(provider)) {
    if (!psd.baseUrl) return { valid: false, error: "Missing base URL", refreshed: false };
    try { return await probeBearerGet(`${(psd.baseUrl as string).replace(/\/$/, "")}/models`, apiKey, effectiveProxy, "Invalid API key or base URL"); }
    catch (err) { return { valid: false, error: (err as Error).message, refreshed: false }; }
  }

  // Anthropic-compatible custom base: POST /v1/messages
  if (isAnthropicCompatibleProvider(provider)) {
    if (!psd.baseUrl) return { valid: false, error: "Missing base URL", refreshed: false };
    try {
      let mb = (psd.baseUrl as string).replace(/\/$/, "");
      if (mb.endsWith("/messages")) mb = mb.slice(0, -9);
      const model = (connection.defaultModel as string) || "claude-3-haiku-20240307";
      const res = await fetchWithConnectionProxy(`${mb}/v1/messages`, { method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "test" }] }) }, effectiveProxy);
      const valid = res.status !== 401 && res.status !== 403;
      return { valid, error: valid ? null : "Invalid API key or base URL" };
    } catch (err) { return { valid: false, error: (err as Error).message, refreshed: false }; }
  }

  try {
    // ── Family 1: simple Bearer GET /models ──────────────────────────────
    if (SIMPLE_BEARER_MODELS[provider]) return probeBearerGet(SIMPLE_BEARER_MODELS[provider], apiKey, effectiveProxy);
    if (XIAOMI_MODELS_URLS[provider]) return probeBearerGet(XIAOMI_MODELS_URLS[provider], apiKey, effectiveProxy);

    // ── Family 2: Anthropic-style POST /v1/messages ──────────────────────
    if (ANTHROPIC_STYLE_PROBES[provider]) {
      const p = ANTHROPIC_STYLE_PROBES[provider];
      return probeAnthropicStyle(p.url, apiKey, p.model, effectiveProxy, p.alsoReject403);
    }

    // ── Family 3: custom-auth GET (Token / Key / no-proxy) ───────────────
    if (CUSTOM_AUTH_PROBES[provider]) {
      const p = CUSTOM_AUTH_PROBES[provider];
      return probeCustomAuth(p.url, `${p.authPrefix}${apiKey}`, effectiveProxy, p.rejectStatuses, p.noProxy);
    }

    // ── Remaining per-provider cases ─────────────────────────────────────
    switch (provider) {
      case "kilo-gateway": return testKiloGatewayConnection(apiKey, effectiveProxy);
      case "api-airforce": return testApiAirforceConnection(apiKey, effectiveProxy);
      case "cloudflare-ai": {
        if (!psd.accountId) return { valid: false, error: "Missing Account ID", refreshed: false };
        return probeChatCompletions(`https://api.cloudflare.com/client/v4/accounts/${psd.accountId}/ai/v1/chat/completions`,
          { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          { model: getDefaultModel("cloudflare-ai"), messages: [{ role: "user", content: "test" }], max_tokens: 1 },
          effectiveProxy, "Invalid API token or Account ID", [401, 403, 404]);
      }
      case "azure": {
        const endpoint = ((psd.azureEndpoint as string) || "").replace(/\/$/, "");
        const deployment = (psd.deployment as string) || "gpt-4";
        const apiVersion = (psd.apiVersion as string) || "2024-10-01-preview";
        const azHeaders: Record<string, string> = { "api-key": apiKey, "Content-Type": "application/json" };
        if (psd.organization) azHeaders["OpenAI-Organization"] = psd.organization as string;
        return probeChatCompletions(`${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
          azHeaders, { messages: [{ role: "user", content: "test" }], max_completion_tokens: 1 },
          effectiveProxy, "Invalid API key or Azure configuration");
      }
      case "gemini": return fetchWithConnectionProxy(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`, {}, effectiveProxy)
        .then(r => ({ valid: r.ok, error: r.ok ? null : "Invalid API key", refreshed: false }));
      case "glm-cn": return probeChatCompletions("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
        { "Authorization": `Bearer ${apiKey}` }, { model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }, effectiveProxy);
      case "alicode": case "alicode-intl": case "alims-intl": {
        const aliUrl = provider === "alicode-intl" ? "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions"
          : provider === "alims-intl" ? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
          : "https://coding.dashscope.aliyuncs.com/v1/chat/completions";
        return probeChatCompletions(aliUrl, { "Authorization": `Bearer ${apiKey}` },
          { model: getDefaultModel(provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }, effectiveProxy);
      }
      case "volcengine-ark": case "byteplus": return probeChatCompletions(PROVIDERS[provider]?.baseUrl as string,
        { "Authorization": `Bearer ${apiKey}` }, { model: getDefaultModel(provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }, effectiveProxy);
      case "opencode-go": return probeChatCompletions("https://opencode.ai/zen/go/v1/chat/completions",
        { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        { model: getDefaultModel("opencode-go"), messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }, effectiveProxy);
      case "blackbox": return probeBearerGet(
        `${((PROVIDERS["blackbox"]?.baseUrl as string)?.replace(/\/chat\/completions$/, "") || "https://api.blackbox.ai/v1")}/models`, apiKey, effectiveProxy);
      case "qoder": {
        const raw = (apiKey as string) || "";
        const pat = raw.startsWith("pt-") ? raw : `pt-${raw}`;
        const exRes = await fetchWithConnectionProxy("https://openapi.qoder.sh/api/v1/jobToken/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "Cosy-Version": "1.0.1", "Cosy-ClientType": "5" },
          body: JSON.stringify({ personal_token: pat }),
        }, effectiveProxy);
        return { valid: exRes.ok, error: exRes.ok ? null : "Invalid Personal Access Token" };
      }
      case "llm7": return probeBearerGet(
        `${((psd.baseUrl as string) || "https://api.llm7.io/v1").replace(/\/$/, "")}/models`, apiKey, effectiveProxy, "Invalid API key or base URL");
      case "kimchi": return fetchWithConnectionProxy(
        (KIMCHI_CONFIG.validationUrl as string) || "https://api.cast.ai/v1/llm/openai/supported-providers",
        { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "User-Agent": "kimchi/0.1.40" } }, effectiveProxy)
        .then(r => ({ valid: r.ok, error: r.ok ? null : "Invalid API key", refreshed: false }));
      case "naga-ac": case "naga": return fetchWithConnectionProxy(
        (PROVIDERS["naga-ac"]?.validateUrl as string) || "https://api.naga.ac/v1/models",
        { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }, effectiveProxy)
        .then(r => ({ valid: r.ok, error: r.ok ? null : "Invalid API key or base URL", refreshed: false }));
      case "kilocode": case "kc": {
        const kiloBase = ((PROVIDERS["kilocode"]?.baseUrl as string) || "https://api.kilo.ai/api/openrouter/chat/completions").replace(/\/chat\/completions$/, "");
        return probeChatCompletions(`${kiloBase}/chat/completions`, { "Authorization": `Bearer ${apiKey}` },
          { model: (connection.defaultModel as string) || "openrouter/auto", max_tokens: 1, messages: [{ role: "user", content: "test" }] }, effectiveProxy);
      }
      default: return testGenericOpenAiCompatibleConnection(connection, effectiveProxy);
    }
  } catch (err) {
    return { valid: false, error: (err as Error).message, refreshed: false };
  }
}

/**
 * Generic fallback for apikey/freeTier providers with no dedicated case above
 * (config-driven from PROVIDERS, mirroring validateGenericOpenAiCompatible in
 * /api/providers/validate — that route already covers new-key validation, but
 * the "Test Connection" button on an existing connection routes through this
 * switch's default, which previously just hardcoded failure for every
 * provider not individually listed).
 */
async function testGenericOpenAiCompatibleConnection(connection: Record<string, unknown>, effectiveProxy: ConnectionProxyConfig | null = null): Promise<TestResult> {
  const provider = connection.provider as string;
  const cfg = PROVIDERS[provider] as Record<string, unknown> | undefined;
  if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
    return { valid: false, error: "Provider test not supported", refreshed: false };
  }
  if (cfg.noAuth) {
    return { valid: true, error: null, refreshed: false };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", ...((cfg.headers as Record<string, string>) || {}) };
  if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = connection.apiKey as string;
  else headers["Authorization"] = `Bearer ${connection.apiKey}`;

  // Try /models first (fast GET), fallback to a minimal chat probe on ambiguous response.
  const modelsUrl = (cfg.validateUrl as string) || (cfg.baseUrl as string).replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
  try {
    const probeRes = await fetchWithConnectionProxy(modelsUrl, { headers, signal: AbortSignal.timeout(8000) }, effectiveProxy);
    if (probeRes.status === 401 || probeRes.status === 403) {
      return { valid: false, error: "Invalid API key", refreshed: false };
    }
    if (probeRes.ok) return { valid: true, error: null, refreshed: false };
  } catch { /* fall through to chat probe */ }

  const defaultModel = (connection.defaultModel as string) || getDefaultModel(provider) || "test";
  const chatRes = await fetchWithConnectionProxy(cfg.baseUrl as string, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    signal: AbortSignal.timeout(10000),
  }, effectiveProxy);
  const valid = chatRes.status !== 401 && chatRes.status !== 403;
  return { valid, error: valid ? null : "Invalid API key", refreshed: false };
}

/**
 * Test a noAuth provider directly by probing its HTTP endpoint.
 * Used by batch-test "free" mode to cover providers that have no connection record.
 */
export async function testNoAuthProvider(providerId: string): Promise<{ valid: boolean; error: string | null; latencyMs: number }> {
  const config = PROVIDERS[providerId];
  if (!config) return { valid: false, error: "Provider not configured in gateway", latencyMs: 0 };

  const validateUrl = config.validateUrl as string | undefined;
  const baseUrl = config.baseUrl as string | undefined;
  const candidates = [validateUrl, baseUrl].filter(Boolean) as string[];

  for (const testUrl of candidates) {
    if (!testUrl.startsWith("http://") && !testUrl.startsWith("https://")) continue;
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(testUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "ModelHub-BatchTest/1.0" },
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      // Any HTTP response means the endpoint is reachable
      return { valid: true, error: null, latencyMs };
    } catch {
      // try next candidate
    }
  }

  return { valid: false, error: "No testable HTTP endpoint", latencyMs: 0 };
}

/**
 * Test a single connection by ID, update DB, and return result.
 */
export async function testSingleConnection(id: string): Promise<SingleTestResult> {
  const connection = await getProviderConnectionById(id);
  if (!connection) return { valid: false, error: "Connection not found", refreshed: false, latencyMs: 0, testedAt: new Date().toISOString() };

  const effectiveProxy = await resolveConnectionProxyConfig((connection.providerSpecificData || {}) as Record<string, unknown>);

  if (effectiveProxy.connectionProxyEnabled && effectiveProxy.connectionProxyUrl && !effectiveProxy.vercelRelayUrl) {
    const proxyResult = await testProxyUrl({ proxyUrl: effectiveProxy.connectionProxyUrl });
    if (!proxyResult.ok) {
      const proxyError = proxyResult.error || `Proxy test failed with status ${proxyResult.status}`;
      await updateProviderConnection(id, {
        testStatus: "error",
        lastError: proxyError,
        lastErrorAt: new Date().toISOString(),
      });
      return { valid: false, error: proxyError, latencyMs: 0, testedAt: new Date().toISOString() , refreshed: false };
    }
  }

  const start = Date.now();
  let result: TestResult;

  if (connection.authType === "apikey" || connection.authType === "cookie") {
    result = await testApiKeyConnection(connection as unknown as Record<string, unknown>, effectiveProxy);
  } else {
    result = await testOAuthConnection(connection as unknown as Record<string, unknown>, effectiveProxy);
  }

  const latencyMs = Date.now() - start;

  // Soft success (e.g. Grok CLI 402 spending-limit): credentials are good, account is
  // out of credits. Keep testStatus active; surface the message as lastError so the
  // dashboard can show a warning without marking the connection broken.
  const softWarning = result.valid && (result.warning || result.error);
  const updateData: Record<string, unknown> = {
    testStatus: result.valid ? "active" : "error",
    lastError: result.valid ? (softWarning || null) : result.error,
    lastErrorAt: result.valid
      ? softWarning
        ? new Date().toISOString()
        : null
      : new Date().toISOString(),
  };

  if (result.refreshed && result.newTokens) {
    if (result.newTokens.accessToken) updateData.accessToken = result.newTokens.accessToken;
    if (result.newTokens.refreshToken) updateData.refreshToken = result.newTokens.refreshToken;
    if (result.newTokens.idToken) updateData.idToken = result.newTokens.idToken;
    if (result.newTokens.lastRefreshAt) updateData.lastRefreshAt = result.newTokens.lastRefreshAt;
    if (result.newTokens.expiresIn) updateData.expiresIn = result.newTokens.expiresIn;
    if (result.newTokens.expiresIn) {
      updateData.expiresAt = new Date(Date.now() + (result.newTokens.expiresIn as number) * 1000).toISOString();
    } else if (result.newTokens.expiresAt) {
      updateData.expiresAt = result.newTokens.expiresAt;
    }
    if (result.newTokens.providerSpecificData) {
      updateData.providerSpecificData = {
        ...((connection.providerSpecificData as Record<string, unknown>) || {}),
        ...(result.newTokens.providerSpecificData as Record<string, unknown>),
      };
    }
  }

  await updateProviderConnection(id, updateData);

  return { valid: result.valid, error: result.error, refreshed: !!result.refreshed, latencyMs, testedAt: new Date().toISOString() };
}
