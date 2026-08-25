import { IFLOW_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  extraParams: Record<string, string>;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  apiKey: string;
  email: string;
  displayName: string;
}

const iflow = {
  config: IFLOW_CONFIG as ProviderConfig,
  flowType: "authorization_code",
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string): string => {
    const params: URLSearchParams = new URLSearchParams({
      loginMethod: config.extraParams.loginMethod,
      type: config.extraParams.type,
      redirect: redirectUri,
      state: state,
      client_id: config.clientId,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string): Promise<TokenResponse> => {
    const basicAuth: string = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString("base64");

    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  postExchange: async (tokens: TokenResponse): Promise<{ userInfo: Record<string, unknown> }> => {
    const userInfoRes: Response = await fetch(
      `${(IFLOW_CONFIG as ProviderConfig).userInfoUrl}?accessToken=${encodeURIComponent(tokens.access_token)}`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!userInfoRes.ok) {
      const errorText: string = await userInfoRes.text();
      throw new Error(`Failed to fetch user info: ${errorText}`);
    }

    const result: Record<string, unknown> = await userInfoRes.json();
    if (!result.success) {
      throw new Error(`User info request failed: ${result.message || 'Unknown error'}`);
    }

    const userInfo: Record<string, unknown> = (result.data as Record<string, unknown>) || {};

    if (!userInfo.apiKey || (userInfo.apiKey as string).trim() === "") {
      throw new Error("Empty API key returned from iFlow");
    }

    const email: string = ((userInfo.email as string)?.trim() || (userInfo.phone as string)?.trim()) as string;
    if (!email) {
      throw new Error("Missing account email/phone in user info");
    }

    return { userInfo };
  },
  mapTokens: (tokens: TokenResponse, extra: { userInfo: Record<string, unknown> }): MappedTokens => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    apiKey: extra?.userInfo?.apiKey as string,
    email: ((extra?.userInfo?.email as string) || (extra?.userInfo?.phone as string)) as string,
    displayName: ((extra?.userInfo?.nickname as string) || (extra?.userInfo?.name as string)) as string,
  }),
};

export default iflow;
