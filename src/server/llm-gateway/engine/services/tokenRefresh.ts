import { PROVIDERS } from "../config/providers";
import { OAUTH_ENDPOINTS, REFRESH_LEAD_MS } from "../config/appConstants";
import {
  refreshXaiToken,
  refreshAccessToken,
  refreshKimiToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
  refreshTraeToken,
  refreshZedToken,
  refreshWindsurfToken,
  classifyOAuthRefreshError,
} from "./tokenRefresh/providers";
import type { Credentials, RefreshResult, Logger, VertexServiceAccount, UserInfo, RefreshHandler, ProviderConfig } from "./types";

// Re-export all provider refresh functions (preserves public API for all consumers)
export {
  refreshAccessToken,
  refreshKimiToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
  refreshTraeToken,
  refreshZedToken,
  refreshWindsurfToken,
  classifyOAuthRefreshError,
};

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result: unknown): result is { error: string; code?: string } {
  return (
    !!result &&
    typeof result === "object" &&
    ("error" in result) &&
    ((result as RefreshResult).error === "unrecoverable_refresh_error" ||
      (result as RefreshResult).error === "refresh_token_reused" ||
      (result as RefreshResult).error === "invalid_request" ||
      (result as RefreshResult).error === "invalid_grant")
  );
}

export function getRefreshLeadMs(provider: string): number {
  const leadMap = REFRESH_LEAD_MS as Record<string, number>;
  if (leadMap[provider]) return leadMap[provider];
  // Legacy id after kimi-coding → kimi merge
  if (provider === "kimi-coding" && leadMap.kimi) return leadMap.kimi;
  return TOKEN_EXPIRY_BUFFER_MS;
}

export function parseVertexSaJson(apiKey: string): VertexServiceAccount | null {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>;
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key && parsed.project_id) {
      return parsed as unknown as VertexServiceAccount;
    }
    return null;
  } catch {
    return null;
  }
}

// Cache Vertex tokens keyed by service account email { token, expiresAt }
const vertexTokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function refreshVertexToken(saJson: VertexServiceAccount, log?: Logger): Promise<{ accessToken: string; expiresAt: number } | null> {
  const cacheKey = saJson.client_email;
  const cached = vertexTokenCache.get(cacheKey);

  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: cached.token, expiresAt: cached.expiresAt };
  }

  try {
    const { SignJWT, importPKCS8 } = await import("jose");
    log?.debug?.("TOKEN_REFRESH", `Vertex minting token for ${saJson.client_email}`);
    const privateKey = await importPKCS8(saJson.private_key.replace(/\\n/g, "\n"), "RS256");
    const now = Math.floor(Date.now() / 1000);

    const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(saJson.client_email)
      .setAudience(OAUTH_ENDPOINTS.google.token as string)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    const res = await fetch(OAUTH_ENDPOINTS.google.token as string, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log?.error?.("TOKEN_REFRESH", `Vertex token mint failed: ${err}`);
      return null;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const access_token = data.access_token as string;
    const expires_in = (data.expires_in as number) ?? 3600;
    const expiresAt = Date.now() + expires_in * 1000;

    vertexTokenCache.set(cacheKey, { token: access_token, expiresAt });
    log?.info?.("TOKEN_REFRESH", `Vertex token minted for ${saJson.client_email}`);

    return { accessToken: access_token, expiresAt };
  } catch (error: unknown) {
    log?.error?.("TOKEN_REFRESH", `Vertex token error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function vertexRefreshHandler(c: Credentials, log?: Logger) {
  const saJson = parseVertexSaJson(c.apiKey || "");
  if (!saJson) return null;
  return refreshVertexToken(saJson, log);
}

const REFRESH_HANDLERS: Record<string, RefreshHandler> = {
  "gemini-cli": (c, log) => refreshGoogleToken(c.refreshToken || "", (PROVIDERS["gemini-cli"] as ProviderConfig).clientId || "", (PROVIDERS["gemini-cli"] as ProviderConfig).clientSecret || "", log),
  antigravity: (c, log) => refreshGoogleToken(c.refreshToken || "", (PROVIDERS.antigravity as ProviderConfig).clientId || "", (PROVIDERS.antigravity as ProviderConfig).clientSecret || "", log),
  claude: (c, log) => refreshClaudeOAuthToken(c.refreshToken || "", log),
  codex: (c, log) => refreshCodexToken(c.refreshToken || "", log),
  iflow: (c, log) => refreshIflowToken(c.refreshToken || "", log),
  github: (c, log) => refreshGitHubToken(c.refreshToken || "", log),
  kiro: (c, log) => refreshKiroToken(c.refreshToken || "", c.providerSpecificData, log),
  xai: (c, log) => refreshXaiToken(c.refreshToken || "", log),
  // Grok CLI shares xAI OAuth client + token endpoint (device-code tokens refresh the same way)
  "grok-cli": (c, log) => refreshXaiToken(c.refreshToken || "", log),
  gcli: (c, log) => refreshXaiToken(c.refreshToken || "", log),
  "codebuddy-cn": (c, log) => refreshCodebuddyToken(c.refreshToken || "", log),
  "codebuddy-intl": (c, log) => refreshCodebuddyIntlToken(c.refreshToken || "", log),
  trae: (c, log) => refreshTraeToken(c.refreshToken || "", c, log),
  zed: () => refreshZedToken(),
  windsurf: (c, log) => refreshWindsurfToken(c, log),
  // Kimi Code OAuth (merged into id `kimi`); legacy id still routes here
  kimi: (c, log) => refreshKimiToken(c.refreshToken || "", c, log),
  "kimi-coding": (c, log) => refreshKimiToken(c.refreshToken || "", c, log),
  vertex: vertexRefreshHandler as RefreshHandler,
  "vertex-partner": vertexRefreshHandler as RefreshHandler,
};

export async function getAccessToken(provider: string, credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
  if (!credentials || !credentials.refreshToken || typeof credentials.refreshToken !== "string") {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }
  return _getAccessTokenInternal(provider, credentials, log);
}

async function _getAccessTokenInternal(provider: string, credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
  if (provider === "gemini") {
    return refreshGoogleToken(credentials.refreshToken || "", (PROVIDERS.gemini as ProviderConfig).clientId || "", (PROVIDERS.gemini as ProviderConfig).clientSecret || "", log);
  }
  const handler = REFRESH_HANDLERS[provider];
  if (!handler) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider for token refresh: ${provider}`);
    return null;
  }
  return handler(credentials, log);
}

export async function refreshTokenByProvider(provider: string, credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
  if (!credentials.refreshToken) return null;
  const handler = REFRESH_HANDLERS[provider];
  return handler ? handler(credentials, log) : refreshAccessToken(provider, credentials.refreshToken, credentials, log);
}

export function formatProviderCredentials(provider: string, credentials: Credentials, log?: Logger): Record<string, unknown> | null {
  const config = PROVIDERS[provider] as ProviderConfig | undefined;
  if (!config) {
    log?.warn?.("TOKEN_REFRESH", `No configuration found for provider: ${provider}`);
    return null;
  }

  switch (provider) {
    case "gemini":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        projectId: credentials.projectId
      };

    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "codex":
    case "iflow":
    case "openai":
    case "openrouter":
    case "xai":
    case "grok-cli":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "antigravity":
    case "gemini-cli":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken
      };
  }
}

export async function getAllAccessTokens(userInfo: UserInfo, log?: Logger): Promise<Record<string, RefreshResult>> {
  const results: Record<string, RefreshResult> = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log);

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

export async function refreshWithRetry(refreshFn: () => Promise<RefreshResult | null>, maxRetries = 3, log: Logger | null = null): Promise<RefreshResult | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (result) return result;
    } catch (error: unknown) {
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
