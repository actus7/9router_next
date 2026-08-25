import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth";

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  loadCodeAssistEndpoint: string;
  loadCodeAssistUserAgent: string;
  onboardUserEndpoint: string;
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

const antigravity = {
  config: ANTIGRAVITY_CONFIG as ProviderConfig,
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
    const loadHeaders: Record<string, string> = {
      "Authorization": `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": (ANTIGRAVITY_CONFIG as ProviderConfig).loadCodeAssistUserAgent,
      "x-request-source": "local",
    };
    const metadata = getOAuthClientMetadata();

    const userInfoRes: Response = await fetch(`${(ANTIGRAVITY_CONFIG as ProviderConfig).userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "x-request-source": "local",
      },
    });
    const userInfo: Record<string, unknown> = userInfoRes.ok ? await userInfoRes.json() : {};

    let projectId: string = "";
    let tierId: string = "legacy-tier";
    try {
      const loadRes: Response = await fetch((ANTIGRAVITY_CONFIG as ProviderConfig).loadCodeAssistEndpoint, {
        method: "POST",
        headers: loadHeaders,
        body: JSON.stringify({ metadata }),
      });
      if (loadRes.ok) {
        const data: Record<string, unknown> = await loadRes.json();
        projectId = ((data.cloudaicompanionProject as Record<string, unknown>)?.id as string) || (data.cloudaicompanionProject as string) || "";
        if (Array.isArray(data.allowedTiers)) {
          for (const tier of data.allowedTiers) {
            if (tier.isDefault && tier.id) {
              tierId = tier.id.trim();
              break;
            }
          }
        }
      }
    } catch (e: unknown) {
      console.log("Failed to load code assist:", e);
    }

    if (projectId) {
      const doOnboard = async (): Promise<void> => {
        for (let i = 0; i < 10; i++) {
          try {
            const onboardRes: Response = await fetch((ANTIGRAVITY_CONFIG as ProviderConfig).onboardUserEndpoint, {
              method: "POST",
              headers: loadHeaders,
              body: JSON.stringify({ tierId, metadata }),
            });
            if (onboardRes.ok) {
              const result: Record<string, unknown> = await onboardRes.json();
              if (result.done === true) break;
            }
          } catch (e: unknown) {
            break;
          }
          await new Promise<void>((resolve: () => void) => setTimeout(resolve, 5000));
        }
      };
      doOnboard().catch(() => {});
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

export default antigravity;
