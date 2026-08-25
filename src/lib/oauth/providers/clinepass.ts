import { CLINEPASS_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  email: string;
  firstName: string;
  lastName: string;
  expires_at: string;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email: string;
  providerSpecificData: {
    firstName: string;
    lastName: string;
  };
}

const clinepass = {
  config: CLINEPASS_CONFIG as ProviderConfig,
  flowType: "authorization_code",
  buildAuthUrl: (config: ProviderConfig, redirectUri: string): string => {
    const params: URLSearchParams = new URLSearchParams({
      client_type: "extension",
      callback_url: redirectUri,
      redirect_uri: redirectUri,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string): Promise<TokenResponse> => {
    try {
      let base64: string = code;
      const padding: number = 4 - (base64.length % 4);
      if (padding !== 4) base64 += "=".repeat(padding);
      const decoded: string = Buffer.from(base64, "base64").toString("utf-8");
      const lastBrace: number = decoded.lastIndexOf("}");
      if (lastBrace === -1) throw new Error("No JSON found in decoded code");
      const tokenData: Record<string, unknown> = JSON.parse(decoded.substring(0, lastBrace + 1));
      return {
        access_token: tokenData.accessToken as string,
        refresh_token: tokenData.refreshToken as string,
        email: tokenData.email as string,
        firstName: tokenData.firstName as string,
        lastName: tokenData.lastName as string,
        expires_at: tokenData.expiresAt as string,
      };
    } catch (e: unknown) {
      const response: Response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code, client_type: "extension", redirect_uri: redirectUri }),
      });
      if (!response.ok) {
        const error: string = await response.text();
        throw new Error(`ClinePass token exchange failed: ${error}`);
      }
      const data: Record<string, unknown> = await response.json();
      return {
        access_token: ((data.data as Record<string, unknown>)?.accessToken as string) || (data.accessToken as string),
        refresh_token: ((data.data as Record<string, unknown>)?.refreshToken as string) || (data.refreshToken as string),
        email: (((data.data as Record<string, unknown>)?.userInfo as Record<string, unknown>)?.email as string) || "",
        expires_at: ((data.data as Record<string, unknown>)?.expiresAt as string) || (data.expiresAt as string),
      };
    }
  },
  mapTokens: (tokens: TokenResponse): MappedTokens => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_at
      ? Math.floor((new Date(tokens.expires_at).getTime() - Date.now()) / 1000)
      : 3600,
    email: tokens.email,
    providerSpecificData: { firstName: tokens.firstName, lastName: tokens.lastName },
  }),
};

export default clinepass;
