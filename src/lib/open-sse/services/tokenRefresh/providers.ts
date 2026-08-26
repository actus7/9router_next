import { PROVIDERS, PROVIDER_OAUTH } from "../../config/providers";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, buildKimiHeaders } from "../../config/appConstants";
import { proxyAwareFetch } from "../../utils/proxyFetch";
import { dedupRefresh } from "./dedup";
import { buildExternalIdpRefreshParams } from "@/lib/oauth/kiroExternalIdp";
import type { Credentials, RefreshResult, Logger, ProviderSpecificData, OAuthProviderConfig, ProviderConfig, RefreshProfile } from "../types";

let _xaiServiceSingleton: { refreshAccessToken(token: string): Promise<Record<string, unknown>> } | null = null;
export async function refreshXaiToken(refreshToken: string, log?: Logger): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  return dedupRefresh<RefreshResult | null>("xai", refreshToken, async () => {
    try {
      if (!_xaiServiceSingleton) {
        const mod = await import("@/lib/oauth/services/xai") as unknown as { XaiService: new () => { refreshAccessToken(token: string): Promise<Record<string, unknown>> } };
        _xaiServiceSingleton = new mod.XaiService();
      }
      const tokens = await _xaiServiceSingleton!.refreshAccessToken(refreshToken);
      return {
        accessToken: tokens.access_token as string,
        refreshToken: (tokens.refresh_token as string) || refreshToken,
        expiresIn: tokens.expires_in as number,
        idToken: tokens.id_token as string,
      };
    } catch (e: unknown) {
      log?.warn?.("TOKEN_REFRESH", `xai refresh failed: ${e instanceof Error ? e?.message : String(e)}`);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("invalid_grant") || msg.includes("invalid_request")) {
        return { error: "invalid_grant" };
      }
      return null;
    }
  }, log);
}

// Per-provider refresh variants for the generic path. Keys not listed fall back
// to the default form-encoded OAuth2 refresh with client_id + client_secret.
const REFRESH_PROFILES: Record<string, RefreshProfile> = {
  claude: {
    bodyFormat: "json",
    includeClientSecret: false,
    url: () => OAUTH_ENDPOINTS.anthropic.token as string,
    dedupKey: "claude",
  },
  iflow: {
    url: () => OAUTH_ENDPOINTS.iflow.token as string,
    dedupKey: "iflow",
    extraHeaders: (creds: Credentials, cfg: Record<string, unknown>) => ({
      Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
    }),
  },
  github: {
    url: () => OAUTH_ENDPOINTS.github.token as string,
    dedupKey: "github",
    includeClientSecret: (cfg: Record<string, unknown>) => !!cfg?.clientSecret,
  },
  kimi: {
    dedupKey: "kimi",
    extraHeaders: (creds: Credentials) => buildKimiHeaders(creds?.providerSpecificData?.deviceId as string),
  },
};

function resolveRefreshUrl(provider: string, config: ProviderConfig | undefined, profile: RefreshProfile): string | null {
  if (profile?.url) {
    try { return profile.url(); } catch { /* fall through */ }
  }
  const oauthCfg = PROVIDER_OAUTH[provider] as OAuthProviderConfig | undefined;
  return (config?.refreshUrl as string) || oauthCfg?.tokenUrl || null;
}

function buildRefreshBody(profile: RefreshProfile, config: ProviderConfig, refreshToken: string): { format: string; body: string | URLSearchParams } {
  const fmt = profile?.bodyFormat === "json" ? "json" : "form";
  const includeSecret = profile?.includeClientSecret === undefined
    ? true
    : typeof profile.includeClientSecret === "function"
      ? profile.includeClientSecret(config)
      : profile.includeClientSecret;
  const payload: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId as string,
  };
  if (includeSecret && config.clientSecret) payload.client_secret = config.clientSecret as string;
  if (fmt === "json") return { format: "json", body: JSON.stringify(payload) };
  return { format: "form", body: new URLSearchParams(payload) };
}

export async function refreshAccessToken(provider: string, refreshToken: string, credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
  const config = PROVIDERS[provider] as ProviderConfig | undefined;
  const profile = REFRESH_PROFILES[provider] || {};
  const url = resolveRefreshUrl(provider, config, profile);

  if (!config || !url) {
    log?.warn?.("TOKEN_REFRESH", `No refresh URL configured for provider: ${provider}`);
    return null;
  }

  if (!refreshToken) {
    log?.warn?.("TOKEN_REFRESH", `No refresh token available for provider: ${provider}`);
    return null;
  }

  const dedupKey = profile.dedupKey || provider;

  return dedupRefresh<RefreshResult | null>(dedupKey, refreshToken, async () => {
  try {
    const { format: bodyFormat, body } = buildRefreshBody(profile, config, refreshToken);
    const headers: Record<string, string> = {
      "Content-Type": bodyFormat === "json" ? "application/json" : "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(profile.extraHeaders ? (profile.extraHeaders(credentials, config) || {}) : {}),
    };
    const response = await fetch(url, { method: "POST", headers, body });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", `Failed to refresh token for ${provider}`, {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    log?.info?.("TOKEN_REFRESH", `Successfully refreshed token for ${provider}`, {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || refreshToken,
      expiresIn: tokens.expires_in as number,
      ...(profile.parse ? (profile.parse(tokens) || {}) : {}),
    };
  } catch (error: unknown) {
    log?.error?.("TOKEN_REFRESH", `Error refreshing token for ${provider}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  }, log);
}

// CLIProxyAPI DeviceFlowClient.RefreshToken: form body (no client_secret) + X-Msh-* headers
// Delegate to refreshAccessToken("kimi", ...) — profile carries the X-Msh headers.
export async function refreshKimiToken(refreshToken: string, credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
  return refreshAccessToken("kimi", refreshToken, credentials, log);
}

// Claude OAuth: JSON body, client_id only. Delegate to refreshAccessToken("claude", ...).
export async function refreshClaudeOAuthToken(refreshToken: string, log?: Logger): Promise<RefreshResult | null> {
  return refreshAccessToken("claude", refreshToken, {}, log);
}

export async function refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string, log?: Logger): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  return dedupRefresh<RefreshResult | null>(`google:${clientId}`, refreshToken, async () => {
  try {
    const response = await fetch(OAUTH_ENDPOINTS.google.token as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Google token", { status: response.status, error: errorText });
      return null;
    }

    const tokens = (await response.json()) as Record<string, unknown>;
    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Google token", { hasNewAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });
    return { accessToken: tokens.access_token as string, refreshToken: (tokens.refresh_token as string) || refreshToken, expiresIn: tokens.expires_in as number };
  } catch (error: unknown) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Google token: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  }, log);
}

export function classifyOAuthRefreshError(errorText = "", status = 0): { status: number; code: string; description: string; permanent: boolean } {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = errorText ? JSON.parse(errorText) as Record<string, unknown> : null;
  } catch {
    parsed = null;
  }

  const errorObj = parsed?.error as Record<string, unknown> | string | undefined;
  const code = String((typeof errorObj === "object" ? errorObj?.code : errorObj) || parsed?.error_code || "");
  const description = String(parsed?.error_description || parsed?.message || errorText || "");
  const combined = `${code} ${description}`.toLowerCase();
  const permanent = [
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
    "invalid_grant",
  ].some((marker) => combined.includes(marker));

  return { status, code, description, permanent };
}

export async function refreshCodexToken(refreshToken: string, log?: Logger): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  return dedupRefresh<RefreshResult | null>("codex", refreshToken, async () => {
    try {
      const response = await fetch(OAUTH_ENDPOINTS.openai.token as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: (PROVIDERS.codex as ProviderConfig).clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const failure = classifyOAuthRefreshError(errorText, response.status);
        if (failure.permanent) {
          log?.error?.("TOKEN_REFRESH", "Codex refresh token already used or invalid. Re-auth required.", {
            status: response.status,
            code: failure.code,
          });
          return { error: "unrecoverable_refresh_error", code: failure.code };
        }

        log?.error?.("TOKEN_REFRESH", "Failed to refresh Codex token", {
          status: response.status,
          error: errorText,
          code: failure.code,
          permanent: failure.permanent,
        });
        return null;
      }

      const tokens = (await response.json()) as Record<string, unknown>;

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Codex token", {
        hasNewAccessToken: !!tokens.access_token,
        hasNewRefreshToken: !!tokens.refresh_token,
        hasIdToken: !!tokens.id_token,
        expiresIn: tokens.expires_in,
      });

      return {
        accessToken: tokens.access_token as string,
        refreshToken: (tokens.refresh_token as string) || refreshToken,
        idToken: tokens.id_token as string,
        expiresIn: tokens.expires_in as number,
      };
    } catch (error: unknown) {
      log?.error?.("TOKEN_REFRESH", `Network error refreshing Codex token: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }, log);
}

async function resolveKiroProfileArnPatch(providerSpecificData: ProviderSpecificData | undefined, accessToken: string, refreshedArn?: string): Promise<Partial<RefreshResult>> {
  if (providerSpecificData?.profileArn) return {};
  let profileArn = refreshedArn?.trim?.() || null;
  if (!profileArn) {
    const { fetchKiroProfileArn } = await import("@/lib/oauth/providerHelpers") as { fetchKiroProfileArn: (token: string) => Promise<string | null> };
    profileArn = await fetchKiroProfileArn(accessToken);
  }
  return profileArn ? { providerSpecificData: { profileArn } as ProviderSpecificData } : {};
}

export async function refreshKiroToken(refreshToken: string, providerSpecificData: ProviderSpecificData | undefined, log?: Logger, proxyOptions: null = null): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  return dedupRefresh<RefreshResult | null>("kiro", refreshToken, async () => {
  const authMethod = providerSpecificData?.authMethod as string;
  const clientId = providerSpecificData?.clientId as string;
  const clientSecret = providerSpecificData?.clientSecret as string;
  const region = providerSpecificData?.region as string;

  if (authMethod === "external_idp") {
    let refreshRequest;
    try {
      refreshRequest = buildExternalIdpRefreshParams(refreshToken, providerSpecificData);
    } catch (error: unknown) {
      log?.warn?.("TOKEN_REFRESH", `Invalid Kiro external_idp refresh config: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }

    const response = (await proxyAwareFetch(refreshRequest.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: refreshRequest.body,
    }, proxyOptions)) as Response;

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro external_idp token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro external_idp token", {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || refreshToken,
      expiresIn: tokens.expires_in as number,
      providerSpecificData: refreshRequest.providerSpecificData,
    };
  }

  if (clientId && clientSecret) {
    const isIDC = authMethod === "idc";
    const endpoint = isIDC && region
      ? `https://oidc.${region}.amazonaws.com/token`
      : "https://oidc.us-east-1.amazonaws.com/token";

    const response = (await proxyAwareFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientId: clientId,
        clientSecret: clientSecret,
        refreshToken: refreshToken,
        grantType: "refresh_token",
      }),
    }, proxyOptions)) as Response;

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro AWS token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = (await response.json()) as Record<string, unknown>;

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro AWS token", {
      hasNewAccessToken: !!tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });

    return {
      accessToken: tokens.accessToken as string,
      refreshToken: (tokens.refreshToken as string) || refreshToken,
      expiresIn: tokens.expiresIn as number,
      ...(await resolveKiroProfileArnPatch(providerSpecificData, tokens.accessToken as string, tokens.profileArn as string)),
    };
  }

  const kiroCfg = PROVIDERS.kiro as ProviderConfig | undefined;
  const response = (await proxyAwareFetch(kiroCfg?.tokenUrl as string, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "kiro-cli/1.0.0",
    },
    body: JSON.stringify({
      refreshToken: refreshToken,
    }),
  }, proxyOptions)) as Response;

  if (!response.ok) {
    const errorText = await response.text();
    log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro social token", {
      status: response.status,
      error: errorText,
    });
    return null;
  }

  const tokens = (await response.json()) as Record<string, unknown>;

  log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro social token", {
    hasNewAccessToken: !!tokens.accessToken,
    expiresIn: tokens.expiresIn,
  });

  return {
    accessToken: tokens.accessToken as string,
    refreshToken: (tokens.refreshToken as string) || refreshToken,
    expiresIn: tokens.expiresIn as number,
    ...(await resolveKiroProfileArnPatch(providerSpecificData, tokens.accessToken as string, tokens.profileArn as string)),
  };
  }, log);
}

// iFlow: Basic Auth + client_id+client_secret in body. Delegate to refreshAccessToken("iflow", ...).
export async function refreshIflowToken(refreshToken: string, log?: Logger): Promise<RefreshResult | null> {
  return refreshAccessToken("iflow", refreshToken, {}, log);
}

// GitHub: optional client_secret. Delegate to refreshAccessToken("github", ...).
export async function refreshGitHubToken(refreshToken: string, log?: Logger): Promise<RefreshResult | null> {
  return refreshAccessToken("github", refreshToken, {}, log);
}

export async function refreshCopilotToken(githubAccessToken: string, log?: Logger): Promise<RefreshResult | null> {
  if (!githubAccessToken) return null;
  return dedupRefresh<RefreshResult | null>("copilot", githubAccessToken, async () => {
  try {
    const githubOauth = PROVIDER_OAUTH["github"] as OAuthProviderConfig | undefined;
    const response = await fetch(githubOauth?.copilotTokenUrl as string, {
      headers: {
        "Authorization": `token ${githubAccessToken}`,
        "User-Agent": GITHUB_COPILOT.USER_AGENT || "",
        "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION || ""}`,
        "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION || ""}`,
        "Accept": "application/json",
        "x-github-api-version": GITHUB_COPILOT.API_VERSION || ""
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Copilot token", {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Copilot token", {
      hasToken: !!data.token,
      expiresAt: data.expires_at
    });

    return {
      token: data.token as string,
      expiresAt: data.expires_at as string
    };
  } catch (error: unknown) {
    log?.error?.("TOKEN_REFRESH", "Error refreshing Copilot token", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
  }, log);
}

// CodeBuddy (Tencent) refresh — POST /v2/plugin/auth/token/refresh with the
// refresh token carried in the X-Refresh-Token header (not a form body),
// matching the official CodeBuddy CLI. Response: { code: 0, data: <token> }.
export async function refreshCodebuddyToken(refreshToken: string, log?: Logger): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  return dedupRefresh<RefreshResult | null>("codebuddy-cn", refreshToken, async () => {
    const oauth = (PROVIDER_OAUTH["codebuddy-cn"] || {}) as OAuthProviderConfig;
    const response = await fetch(oauth.refreshUrl as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": oauth.userAgent as string,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "copilot.tencent.com",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
        "X-Product": "SaaS",
      },
      body: "{}",
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const dataObj = data.data as Record<string, unknown> | undefined;
    if (data.code !== 0 || !dataObj?.accessToken) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy token refresh returned no token", {
        code: data.code,
        msg: data.msg,
      });
      return null;
    }

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed CodeBuddy token", {
      hasNewAccessToken: !!dataObj.accessToken,
      hasNewRefreshToken: !!dataObj.refreshToken,
      expiresIn: dataObj.expiresIn,
    });

    return {
      accessToken: dataObj.accessToken as string,
      refreshToken: (dataObj.refreshToken as string) || refreshToken,
      expiresIn: dataObj.expiresIn as number,
    };
  }, log);
}

export async function refreshCodebuddyIntlToken(refreshToken: string, log?: Logger): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  return dedupRefresh<RefreshResult | null>("codebuddy-intl", refreshToken, async () => {
    const oauth = (PROVIDER_OAUTH["codebuddy-intl"] || {}) as OAuthProviderConfig;
    const response = await fetch(oauth.refreshUrl as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": oauth.userAgent as string,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "www.codebuddy.ai",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
        "X-Product": "SaaS",
      },
      body: "{}",
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy intl token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const dataObj = data.data as Record<string, unknown> | undefined;
    if (data.code !== 0 || !dataObj?.accessToken) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy intl token refresh returned no token", {
        code: data.code,
        msg: data.msg,
      });
      return null;
    }

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed CodeBuddy intl token", {
      hasNewAccessToken: !!dataObj.accessToken,
      hasNewRefreshToken: !!dataObj.refreshToken,
      expiresIn: dataObj.expiresIn,
    });

    return {
      accessToken: dataObj.accessToken as string,
      refreshToken: (dataObj.refreshToken as string) || refreshToken,
      expiresIn: dataObj.expiresIn as number,
    };
  }, log);
}

// Trae refresh — POST ExchangeToken with JSON body {ClientID, RefreshToken, ClientSecret, UserID}.
// Response: {Result: {AccessToken, RefreshToken, TokenType, ExpiresAt}}.
export async function refreshTraeToken(refreshToken: string, credentials: Credentials, log?: Logger): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  const oauth = (PROVIDER_OAUTH.trae || {}) as OAuthProviderConfig;
  const url = (oauth.exchangeTokenUrl || oauth.tokenUrl) as string;
  if (!url) {
    log?.warn?.("TOKEN_REFRESH", "No Trae exchangeTokenUrl configured");
    return null;
  }

  return dedupRefresh<RefreshResult | null>("trae", refreshToken, async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Trae/1.0.0 antigravity-cockpit-tools",
        },
        body: JSON.stringify({
          ClientID: (oauth.clientId as string) || "ono9krqynydwx5",
          RefreshToken: refreshToken,
          ClientSecret: (oauth.clientSecret as string) || "-",
          UserID: "",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Trae token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const result = (payload?.Result || payload?.result || payload) as Record<string, unknown>;
      const accessToken = (result?.AccessToken || result?.accessToken) as string;
      if (!accessToken) {
        log?.error?.("TOKEN_REFRESH", "Trae refresh returned no AccessToken", { payload });
        return null;
      }

      const newRefresh = ((result?.RefreshToken || result?.refreshToken) as string) || refreshToken;
      const expiresAt = result?.ExpiresAt || result?.expiresAt;
      let expiresIn: number | undefined;
      if (typeof expiresAt === "number") {
        expiresIn = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      } else if (typeof expiresAt === "string") {
        const ms = new Date(expiresAt).getTime() - Date.now();
        expiresIn = ms > 0 ? Math.floor(ms / 1000) : undefined;
      }

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Trae token", {
        hasNewAccessToken: !!accessToken,
        hasNewRefreshToken: newRefresh !== refreshToken,
        expiresIn,
      });

      return {
        accessToken,
        refreshToken: newRefresh,
        expiresIn,
      };
    } catch (error: unknown) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing Trae token: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }, log);
}

// Zed access_token is long-lived; auth flow returns no refresh_token.
// No refresh possible — re-login required when token expires/revoked.
// Mirrors cursor/kilocode null-refresh pattern.
export function refreshZedToken(): null {
  return null;
}

// Windsurf apiKey is the long-lived terminal credential (no OAuth2 refresh_token
// grant yields a fresh apiKey). Refresh handled out-of-band by the caller.
// Firebase JWT: if short-lived credentials must be refreshed, re-run RegisterUser
// with the refreshed Firebase JWT (separate code path).
export async function refreshWindsurfToken(credentials: Credentials, log?: Logger): Promise<null> {
  log?.info?.(
    "TOKEN_REFRESH",
    "windsurf: apiKey is long-lived (no refresh_token flow) — skipping"
  );
  return null;
}
