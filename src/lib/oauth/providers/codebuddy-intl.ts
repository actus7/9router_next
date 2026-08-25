import { CODEBUDDY_INTL_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  stateUrl: string;
  platform: string;
  userAgent: string;
  pollInterval: number;
  tokenUrl: string;
  [key: string]: unknown;
}

interface DeviceCodeResponse {
  device_code: string;
  verification_uri: string;
  user_code: string;
  interval: number;
  _isCodeBuddy: boolean;
}

interface PollResult {
  ok: boolean;
  data: Record<string, unknown>;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  providerSpecificData: Record<string, unknown>;
}

const codebuddyIntl = {
  config: CODEBUDDY_INTL_CONFIG as ProviderConfig,
  flowType: "device_code",
  requestDeviceCode: async (config: ProviderConfig): Promise<DeviceCodeResponse> => {
    const response: Response = await fetch(`${config.stateUrl}?platform=${config.platform}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": config.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "www.codebuddy.ai",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-Product": "SaaS",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error(`CodeBuddy Intl state request failed: ${await response.text()}`);
    const data: Record<string, unknown> = await response.json();
    if (data.code !== 0 || !(data.data as Record<string, unknown>)?.state || !(data.data as Record<string, unknown>)?.authUrl) {
      throw new Error(`CodeBuddy Intl state error: ${data.msg || "missing state/authUrl"}`);
    }
    return {
      device_code: (data.data as Record<string, unknown>).state as string,
      verification_uri: (data.data as Record<string, unknown>).authUrl as string,
      user_code: "",
      interval: config.pollInterval / 1000,
      _isCodeBuddy: true,
    };
  },
  pollToken: async (config: ProviderConfig, deviceCode: string): Promise<PollResult> => {
    const response: Response = await fetch(`${config.tokenUrl}?state=${encodeURIComponent(deviceCode)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "www.codebuddy.ai",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-No-Enterprise-Id": "true",
        "X-No-Department-Info": "true",
        "X-Product": "SaaS",
      },
    });
    if (!response.ok) return { ok: false, data: { error: "request_failed" } };
    const data: Record<string, unknown> = await response.json();
    if (data.code === 0 && (data.data as Record<string, unknown>)?.accessToken) {
      return {
        ok: true,
        data: {
          access_token: (data.data as Record<string, unknown>).accessToken,
          refresh_token: (data.data as Record<string, unknown>).refreshToken || "",
          token_type: (data.data as Record<string, unknown>).tokenType || "Bearer",
          expires_in: (data.data as Record<string, unknown>).expiresIn,
        },
      };
    }
    if (data.code === 11217) return { ok: true, data: { error: "authorization_pending" } };
    return { ok: false, data: { error: data.msg || "unknown_error" } };
  },
  mapTokens: (tokens: Record<string, unknown>): MappedTokens => ({
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    expiresIn: (tokens.expires_in as number) || 86400,
    providerSpecificData: {},
  }),
};

export default codebuddyIntl;
