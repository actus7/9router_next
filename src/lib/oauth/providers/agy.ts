import { AGY_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  clientId: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  codeChallengeMethod: string;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  email?: string;
}

const agy = {
  config: AGY_CONFIG as ProviderConfig,
  flowType: "authorization_code_pkce",
  fixedPort: 1455,
  callbackPath: "/auth/callback",
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string, codeChallenge: string): string => {
    const params: URLSearchParams = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      access_type: "offline",
      prompt: "consent",
    });
    return `${config.authorizeUrl}?${params.toString()}`;
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
      throw new Error(`Agy token exchange failed: ${error}`);
    }

    return await response.json();
  },
  mapTokens: (tokens: TokenResponse): MappedTokens => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
  }),
};

export default agy;
