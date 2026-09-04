import { PROVIDER_OAUTH } from "../../config/providers";
import { dedupRefresh } from "./dedup";
import type { Credentials, RefreshResult, Logger, OAuthProviderConfig } from "../types";

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

