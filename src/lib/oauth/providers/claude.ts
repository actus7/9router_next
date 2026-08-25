import { CLAUDE_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  clientId: string;
  scopes: string[];
  codeChallengeMethod: string;
  authorizeUrl: string;
  tokenUrl: string;
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
}

const claude = {
  config: CLAUDE_CONFIG as ProviderConfig,
  flowType: "authorization_code_pkce",
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string, codeChallenge: string): string => {
    const params: URLSearchParams = new URLSearchParams({
      code: "true",
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      state: state,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string, codeVerifier: string, state: string): Promise<TokenResponse> => {
    let authCode: string = code;
    let codeState: string = "";
    if (authCode.includes("#")) {
      const parts: string[] = authCode.split("#");
      authCode = parts[0];
      codeState = parts[1] || "";
    }

    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code: authCode,
        state: codeState || state,
        grant_type: "authorization_code",
        client_id: config.clientId,
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
  mapTokens: (tokens: TokenResponse): MappedTokens => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
  }),
};

export default claude;
