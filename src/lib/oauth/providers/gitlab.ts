import { GITLAB_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  scope: string;
  codeChallengeMethod: string;
  authorizeUrlPath: string;
  tokenUrlPath: string;
  userInfoUrlPath: string;
  defaultBaseUrl: string;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  _user: Record<string, unknown>;
  _baseUrl: string;
  _clientId: string;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  providerSpecificData: {
    username: string;
    email: string;
    name: string;
    baseUrl: string;
    clientId: string;
    authKind: string;
  };
}

const gitlab = {
  config: GITLAB_CONFIG as ProviderConfig,
  flowType: "authorization_code_pkce",
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string, codeChallenge: string, meta: Record<string, unknown> = {}): string => {
    const baseUrl: string = (meta.baseUrl as string) || config.defaultBaseUrl;
    const clientId: string = (meta.clientId as string) || "";
    const params: URLSearchParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
    });
    return `${baseUrl}${config.authorizeUrlPath}?${params.toString()}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string, codeVerifier: string, state: string, meta: Record<string, unknown> = {}): Promise<TokenResponse> => {
    const baseUrl: string = (meta.baseUrl as string) || config.defaultBaseUrl;
    const clientId: string = (meta.clientId as string) || "";
    const clientSecret: string = (meta.clientSecret as string) || "";
    const body: URLSearchParams = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    if (clientSecret) body.set("client_secret", clientSecret);
    const response: Response = await fetch(`${baseUrl}${config.tokenUrlPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`GitLab token exchange failed: ${await response.text()}`);
    const tokens: Record<string, unknown> = await response.json();
    const userRes: Response = await fetch(`${baseUrl}${config.userInfoUrlPath}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user: Record<string, unknown> = userRes.ok ? await userRes.json() : {};
    return { ...tokens, _user: user, _baseUrl: baseUrl, _clientId: clientId } as TokenResponse;
  },
  mapTokens: (tokens: TokenResponse): MappedTokens => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    providerSpecificData: {
      username: (tokens._user?.username as string) || "",
      email: (tokens._user?.email as string) || (tokens._user?.public_email as string) || "",
      name: (tokens._user?.name as string) || "",
      baseUrl: tokens._baseUrl,
      clientId: tokens._clientId,
      authKind: "oauth",
    },
  }),
};

export default gitlab;
