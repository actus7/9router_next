import { buildClineHeaders, refreshProviderCredentials, shouldRefreshCredentials } from "@/server/llm-gateway/auth";
import { PROVIDERS } from "@/server/llm-gateway/catalog";
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CLINE_CONFIG,
  GEMINI_CONFIG,
  KILOCODE_CONFIG,
  KIMCHI_CONFIG,
  KIRO_CONFIG,
} from "@/lib/oauth/constants/oauth";
import { fetchWithConnectionProxy } from "./providerTestTransport";
import type { ConnectionProxyConfig, TestResult } from "./providerTestTypes";

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
  ok: boolean;
  error: string | null;
  soft: boolean;
}

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
 * Reachable from tests through the `__test__` export at the bottom of this file.
 */
function classifyOAuthProbeResult(res: Response | null, config: OAuthTestConfig | null, _bodyText = ""): ProbeResult {
  if (!res) return { ok: false, error: "No response", soft: false };
  const status = res.status;
  const accepted = res.ok || (config?.acceptStatuses && config.acceptStatuses.includes(status));
  if (!accepted) {
    if (status === 401) return { ok: false, error: "Token invalid or revoked", soft: false };
    if (status === 403) return { ok: false, error: "Access denied", soft: false };
    return { ok: false, error: `API returned ${status}`, soft: false };
  }

  if (!res.ok && config?.acceptStatuses?.includes(status)) {
    const softMap = config.softFailMessage || {};
    if (softMap[status]) {
      return { ok: true, error: softMap[status], soft: true };
    }
    return { ok: true, error: null, soft: false };
  }

  return { ok: true, error: null, soft: false };
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

async function probeCloudCodeAssistAccess(connection: Record<string, unknown>, accessToken: string, effectiveProxy: ConnectionProxyConfig | null = null): Promise<{ ok: boolean; error: string | null; status?: number }> {
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

  if (res.ok) return { ok: true, error: null };

  const bodyText = await res.text().catch(() => "");
  return {
    ok: false,
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

export async function testOAuthConnection(connection: Record<string, unknown>, effectiveProxy: ConnectionProxyConfig | null = null): Promise<TestResult> {
  const config = OAUTH_TEST_CONFIG[connection.provider as string];
  if (!config) return { ok: false, error: "Provider test not supported", refreshed: false };
  if (!connection.accessToken) return { ok: false, error: "No access token", refreshed: false };

  if (config.tokenExists) {
    return { ok: true, error: null, refreshed: false, newTokens: null };
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
      return { ok: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  if (config.checkExpiry) {
    if (refreshed) return { ok: true, error: null, refreshed, newTokens };
    if (tokenExpired) return { ok: false, error: "Token expired", refreshed: false };
    return { ok: true, error: null, refreshed: false, newTokens: null };
  }

  if (connection.provider === "gemini-cli" || connection.provider === "antigravity") {
    const initial = await probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy);
    if (initial.ok) return { ok: true, error: null, refreshed, newTokens };

    if (initial.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens?.accessToken) {
        const retry = await probeCloudCodeAssistAccess(connection, tokens.accessToken as string, effectiveProxy);
        if (retry.ok) return { ok: true, error: null, refreshed: true, newTokens: tokens };
        return { ok: false, error: retry.error, refreshed: true, newTokens: tokens };
      }
      return { ok: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { ok: false, error: initial.error, refreshed };
  }

  if (connection.provider === "cline") {
    const tryProbe = async (token: string): Promise<TestResult> => {
      const res = await probeClineAccessToken(token);
      if (res.ok) return { ok: true, error: null, refreshed, newTokens };
      if (res.status === 401) return { ok: false, error: "Token invalid or revoked", refreshed };
      if (res.status === 403) return { ok: false, error: "Access denied", refreshed };
      return { ok: false, error: `API returned ${res.status}`, refreshed };
    };

    const initial = await tryProbe(accessToken);
    if (initial.ok || initial.error !== "Token invalid or revoked" || !connection.refreshToken) {
      return initial;
    }

    const tokens = await refreshOAuthToken(connection);
    if (!tokens?.accessToken) {
      return { ok: false, error: "Token invalid or revoked", refreshed: false };
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
    if (classified.ok) {
      return {
        ok: true,
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
        if (retryClassified.ok) {
          return {
            ok: true,
            error: retryClassified.soft ? retryClassified.error : null,
            warning: retryClassified.soft ? retryClassified.error : null,
            refreshed: true,
            newTokens: tokens,
          };
        }
      }
      return { ok: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { ok: false, error: classified.error, refreshed };
  } catch (err) {
    return { ok: false, error: (err as Error).message, refreshed };
  }
}

// Status classification and expiry are the two decisions worth pinning without
// standing up a whole OAuth probe.
export const __test__ = { classifyOAuthProbeResult, isTokenExpired };
