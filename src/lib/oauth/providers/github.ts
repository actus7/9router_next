import { GITHUB_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  clientId: string;
  scopes: string;
  deviceCodeUrl: string;
  tokenUrl: string;
  copilotTokenUrl: string;
  userInfoUrl: string;
  apiVersion: string;
  userAgent: string;
  [key: string]: unknown;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface PollResult {
  ok: boolean;
  data: Record<string, unknown>;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  name: string;
  displayName: string;
  email: string | null;
  providerSpecificData: {
    copilotToken: string;
    copilotTokenExpiresAt: string;
    githubUserId: number;
    githubLogin: string;
    githubName: string;
    githubEmail: string;
  };
}

const github = {
  config: GITHUB_CONFIG as ProviderConfig,
  flowType: "device_code",
  requestDeviceCode: async (config: ProviderConfig): Promise<DeviceCodeResponse> => {
    const response: Response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Device code request failed: ${error}`);
    }

    return await response.json();
  },
  pollToken: async (config: ProviderConfig, deviceCode: string): Promise<PollResult> => {
    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch  {
      const text: string = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    return {
      ok: response.ok,
      data: data,
    };
  },
  postExchange: async (tokens: Record<string, unknown>): Promise<{ copilotToken: Record<string, unknown>; userInfo: Record<string, unknown> }> => {
    const copilotRes: Response = await fetch((GITHUB_CONFIG as ProviderConfig).copilotTokenUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": (GITHUB_CONFIG as ProviderConfig).apiVersion,
        "User-Agent": (GITHUB_CONFIG as ProviderConfig).userAgent,
      },
    });
    const copilotToken: Record<string, unknown> = copilotRes.ok ? await copilotRes.json() : {};

    const userRes: Response = await fetch((GITHUB_CONFIG as ProviderConfig).userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": (GITHUB_CONFIG as ProviderConfig).apiVersion,
        "User-Agent": (GITHUB_CONFIG as ProviderConfig).userAgent,
      },
    });
    const userInfo: Record<string, unknown> = userRes.ok ? await userRes.json() : {};

    return { copilotToken, userInfo };
  },
  mapTokens: (tokens: Record<string, unknown>, extra: { copilotToken: Record<string, unknown>; userInfo: Record<string, unknown> }): MappedTokens => ({
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    expiresIn: tokens.expires_in as number,
    name: (extra?.userInfo?.login as string) || (extra?.userInfo?.name as string),
    displayName: (extra?.userInfo?.name as string) || (extra?.userInfo?.login as string),
    email: (extra?.userInfo?.email as string) || null,
    providerSpecificData: {
      copilotToken: extra?.copilotToken?.token as string,
      copilotTokenExpiresAt: extra?.copilotToken?.expires_at as string,
      githubUserId: extra?.userInfo?.id as number,
      githubLogin: extra?.userInfo?.login as string,
      githubName: extra?.userInfo?.name as string,
      githubEmail: extra?.userInfo?.email as string,
    },
  }),
};

export default github;
