import { GROK_CLI_CONFIG } from "../constants/oauth";
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from "../providerHelpers";

interface ProviderConfig {
  clientId: string;
  scope: string;
  deviceCodeUrl: string;
  tokenUrl: string;
  referrer?: string;
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
  refreshToken: string | null;
  expiresIn: number;
  expiresAt: string | null;
  scope: string;
  email?: string;
  displayName?: string;
  providerSpecificData: {
    authMethod: string;
    idToken: string | null;
    email: string | null;
    userId: string | null;
    hasGrokCodeAccess: boolean | null;
    subscriptionTier: string | null;
  };
}

const grokCli = {
  config: GROK_CLI_CONFIG as ProviderConfig,
  flowType: "device_code",
  requestDeviceCode: async (config: ProviderConfig): Promise<DeviceCodeResponse> => {
    const body: URLSearchParams = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scope,
    });
    if (config.referrer) body.set("referrer", config.referrer);

    const response: Response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body,
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Grok CLI device code request failed: ${error}`);
    }

    return await response.json();
  },
  pollToken: async (config: ProviderConfig, deviceCode: string): Promise<PollResult> => {
    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: config.clientId,
      }),
    });

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch {
      const text: string = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    const pending: boolean =
      data?.error === "authorization_pending" ||
      data?.error === "slow_down";
    return {
      ok: response.ok || pending,
      data,
    };
  },
  postExchange: async (tokens: Record<string, unknown>): Promise<{ user: Record<string, unknown> | null }> => {
    try {
      const res: Response = await fetch("https://cli-chat-proxy.grok.com/v1/user", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
          "x-xai-token-auth": "xai-grok-cli",
          "x-grok-client-version": "0.2.93",
        },
      });
      if (res.ok) return { user: await res.json() };
    } catch {
      /* ignore */
    }
    return { user: null };
  },
  mapTokens: (tokens: Record<string, unknown>, extra: { user: Record<string, unknown> | null }): MappedTokens => {
    const email: string | null =
      decodeXaiIdTokenEmail(tokens.id_token as string) ||
      extractEmailFromAccessToken(tokens.access_token as string) ||
      (extra?.user?.email as string) ||
      null;
    const userId: string | null =
      (extra?.user?.userId as string) ||
      (extra?.user?.principalId as string) ||
      null;
    const displayName: string | null = [extra?.user?.firstName, extra?.user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

    const expiresAt: string | null = tokens.expires_in
      ? new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()
      : null;

    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: tokens.expires_in as number,
      expiresAt,
      scope: tokens.scope as string,
      email: email || undefined,
      displayName: displayName || undefined,
      providerSpecificData: {
        authMethod: "device_code",
        idToken: (tokens.id_token as string) || null,
        email: email || null,
        userId,
        hasGrokCodeAccess: (extra?.user?.hasGrokCodeAccess as boolean) ?? null,
        subscriptionTier: (extra?.user?.subscriptionTier as string) ?? null,
      },
    };
  },
};

export default grokCli;
