import { CODEX_CONFIG } from "../constants/oauth";
import { extractCodexAccountInfo, extractEmailFromAccessToken } from "../providerHelpers";

interface ProviderConfig {
  clientId: string;
  scope: string;
  codeChallengeMethod: string;
  authorizeUrl: string;
  tokenUrl: string;
  fixedPort?: number;
  callbackPath?: string;
  extraParams?: Record<string, string>;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
  lastRefreshAt: string;
  email?: string;
  providerSpecificData?: {
    chatgptAccountId?: string;
    chatgptPlanType?: string;
  };
}

const codex = {
  config: CODEX_CONFIG as ProviderConfig,
  flowType: "authorization_code_pkce",
  fixedPort: (CODEX_CONFIG as ProviderConfig).fixedPort,
  callbackPath: (CODEX_CONFIG as ProviderConfig).callbackPath,
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string, codeChallenge: string): string => {
    const params: Record<string, string> = {
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      ...config.extraParams,
      state: state,
    };
    const queryString: string = Object.entries(params)
      .map(([key, value]: [string, string]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    return `${config.authorizeUrl}?${queryString}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> => {
    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  mapTokens: (tokens: TokenResponse): MappedTokens => {
    const info = extractCodexAccountInfo(tokens.id_token);
    const mapped: MappedTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in,
      lastRefreshAt: new Date().toISOString(),
    };
    const email: string | undefined = info.email || extractEmailFromAccessToken(tokens.access_token);
    if (email) mapped.email = email;
    if (info.chatgptAccountId || info.chatgptPlanType) {
      mapped.providerSpecificData = {
        chatgptAccountId: info.chatgptAccountId,
        chatgptPlanType: info.chatgptPlanType,
      };
    }
    return mapped;
  },
};

export default codex;
