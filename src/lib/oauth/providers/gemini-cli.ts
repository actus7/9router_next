import { GEMINI_CONFIG, getOAuthClientMetadata } from "../constants/oauth";

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
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
  projectId?: string;
}

const geminiCli = {
  config: GEMINI_CONFIG as ProviderConfig,
  flowType: "authorization_code",
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string): string => {
    const params: URLSearchParams = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string): Promise<TokenResponse> => {
    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  postExchange: async (tokens: TokenResponse): Promise<{ userInfo: Record<string, unknown>; projectId: string }> => {
    const userInfoRes: Response = await fetch(`${(GEMINI_CONFIG as ProviderConfig).userInfoUrl}?alt=json`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo: Record<string, unknown> = userInfoRes.ok ? await userInfoRes.json() : {};

    let projectId: string = "";
    try {
      const projectRes: Response = await fetch(
        "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            metadata: getOAuthClientMetadata(),
            mode: 1,
          }),
        }
      );
      if (projectRes.ok) {
        const data: Record<string, unknown> = await projectRes.json();
        projectId = ((data.cloudaicompanionProject as Record<string, unknown>)?.id as string) || (data.cloudaicompanionProject as string) || "";
      }
    } catch (e: unknown) {
      console.log("Failed to fetch project ID:", e);
    }

    return { userInfo, projectId };
  },
  mapTokens: (tokens: TokenResponse, extra: { userInfo: Record<string, unknown>; projectId: string }): MappedTokens => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    email: extra?.userInfo?.email as string,
    projectId: extra?.projectId,
  }),
};

export default geminiCli;
