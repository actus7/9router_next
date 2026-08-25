import { KIMCHI_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  webAppUrl?: string;
  validationUrl?: string;
  userInfoUrl?: string;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: null;
  email: string | null;
  displayName: string | null;
  providerSpecificData: {
    authMethod: string;
    userId: string;
    username: string;
  };
}

const kimchi = {
  config: KIMCHI_CONFIG as ProviderConfig,
  flowType: "browser_token",
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string): string => {
    const baseUrl: string = (config.webAppUrl || "https://app.kimchi.dev").replace(/\/+$/, "");
    const params: URLSearchParams = new URLSearchParams({
      callback: redirectUri,
      state,
    });
    return `${baseUrl}/cli-auth?${params.toString()}`;
  },
  exchangeToken: async (config: ProviderConfig, token: string): Promise<Record<string, unknown>> => {
    const accessToken: string = String(token || "").trim();
    if (!accessToken) {
      throw new Error("Missing Kimchi token");
    }

    const validationUrl: string = config.validationUrl || "https://api.cast.ai/v1/llm/openai/supported-providers";
    const validationRes: Response = await fetch(validationUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!validationRes.ok) {
      throw new Error(`Kimchi token validation failed: ${validationRes.status}`);
    }

    let userInfo: Record<string, unknown> = {};
    if (config.userInfoUrl) {
      try {
        const userRes: Response = await fetch(config.userInfoUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (userRes.ok) {
          userInfo = await userRes.json();
        }
      } catch {
        userInfo = {};
      }
    }

    return {
      access_token: accessToken,
      token_type: "Bearer",
      _kimchiUser: userInfo,
    };
  },
  mapTokens: (tokens: Record<string, unknown>): MappedTokens => {
    const user: Record<string, unknown> = (tokens._kimchiUser as Record<string, unknown>) || {};
    const userId: string = user.id ? String(user.id) : "";
    const username: string = (user.username as string) || "";
    const email: string | null = (user.email as string) || (userId ? `kimchi-user-${userId}` : null);
    return {
      accessToken: tokens.access_token as string,
      refreshToken: null,
      email,
      displayName: (user.name as string) || username || null,
      providerSpecificData: {
        authMethod: "browser_token",
        userId,
        username,
      },
    };
  },
};

export default kimchi;
