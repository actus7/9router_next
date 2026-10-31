import { PROVIDER_OAUTH } from "../../config/providers";
import { dedupRefresh } from "./dedup";
import type { RefreshResult, Logger, OAuthProviderConfig } from "../types";

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

// Zed access_token is long-lived; auth flow returns no refresh_token.
// No refresh possible — re-login required when token expires/revoked.
// Mirrors cursor/kilocode null-refresh pattern.
export function refreshZedToken(): null {
  return null;
}
