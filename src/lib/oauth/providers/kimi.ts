import crypto from "crypto";
import { KIMI_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  clientId: string;
  deviceCodeUrl: string;
  tokenUrl: string;
  authorizeDeviceUrl?: string;
  [key: string]: unknown;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  _kimiDeviceId: string;
}

interface PollResult {
  ok: boolean;
  data: Record<string, unknown>;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  providerSpecificData: {
    authMethod: string;
    deviceId?: string;
  };
}

const kimi = {
  config: KIMI_CONFIG as ProviderConfig,
  flowType: "device_code",
  requestDeviceCode: async (config: ProviderConfig): Promise<DeviceCodeResponse> => {
    const { buildKimiHeaders } = await import("@/lib/open-sse/config/appConstants");
    const deviceId: string = crypto.randomUUID();
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...buildKimiHeaders(deviceId),
    };
    const response: Response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers,
      body: new URLSearchParams({ client_id: config.clientId }),
    });
    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Device code request failed: ${error}`);
    }
    const data: Record<string, unknown> = await response.json();
    const authorizeDeviceUrl: string = config.authorizeDeviceUrl || "https://www.kimi.com/code/authorize_device";
    return {
      device_code: data.device_code as string,
      user_code: data.user_code as string,
      verification_uri: (data.verification_uri as string) || authorizeDeviceUrl,
      verification_uri_complete:
        (data.verification_uri_complete as string) ||
        `${authorizeDeviceUrl}?user_code=${data.user_code}`,
      expires_in: data.expires_in as number,
      interval: (data.interval as number) || 5,
      _kimiDeviceId: deviceId,
    };
  },
  pollToken: async (config: ProviderConfig, deviceCode: string, _codeVerifier: string, extraData: Record<string, unknown>): Promise<PollResult> => {
    const { buildKimiHeaders } = await import("@/lib/open-sse/config/appConstants");
    const deviceId: string = extraData?._kimiDeviceId as string;
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...buildKimiHeaders(deviceId),
    };
    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: config.clientId,
        device_code: deviceCode,
      }),
    });
    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch {
      data = { error: "invalid_response", error_description: "non-json token response" };
    }
    if (data.error === "authorization_pending" || data.error === "slow_down") {
      return { ok: true, data };
    }
    if (data.access_token && deviceId) data._kimiDeviceId = deviceId;
    return { ok: response.ok || !!data.access_token || !!data.error, data };
  },
  mapTokens: (tokens: Record<string, unknown>): MappedTokens => ({
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    expiresIn: tokens.expires_in as number,
    providerSpecificData: {
      authMethod: "device_code",
      ...(tokens._kimiDeviceId ? { deviceId: tokens._kimiDeviceId as string } : {}),
    },
  }),
};

export default kimi;
