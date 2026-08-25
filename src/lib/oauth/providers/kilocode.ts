import { KILOCODE_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  initiateUrl: string;
  pollUrlBase: string;
  apiBaseUrl: string;
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
  refreshToken: null;
  expiresIn: null;
  email: string;
  providerSpecificData?: {
    orgId: string;
  };
}

const kilocode = {
  config: KILOCODE_CONFIG as ProviderConfig,
  flowType: "device_code",
  requestDeviceCode: async (config: ProviderConfig): Promise<DeviceCodeResponse> => {
    const response: Response = await fetch(config.initiateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Too many pending authorization requests. Please try again later.");
      }
      const error: string = await response.text();
      throw new Error(`Device auth initiation failed: ${error}`);
    }
    const data: Record<string, unknown> = await response.json();
    return {
      device_code: data.code as string,
      user_code: data.code as string,
      verification_uri: data.verificationUrl as string,
      verification_uri_complete: data.verificationUrl as string,
      expires_in: (data.expiresIn as number) || 300,
      interval: 3,
    };
  },
  pollToken: async (config: ProviderConfig, deviceCode: string): Promise<PollResult> => {
    const response: Response = await fetch(`${config.pollUrlBase}/${deviceCode}`);
    if (response.status === 202) return { ok: false, data: { error: "authorization_pending" } };
    if (response.status === 403) return { ok: false, data: { error: "access_denied", error_description: "Authorization denied by user" } };
    if (response.status === 410) return { ok: false, data: { error: "expired_token", error_description: "Authorization code expired" } };
    if (!response.ok) return { ok: false, data: { error: "poll_failed", error_description: `Poll failed: ${response.status}` } };
    const data: Record<string, unknown> = await response.json();
    if (data.status === "approved" && data.token) {
      let orgId: string | null = null;
      try {
        const profileRes: Response = await fetch(`${config.apiBaseUrl}/api/profile`, {
          headers: { "Authorization": `Bearer ${data.token}` }
        });
        if (profileRes.ok) {
          const profile: Record<string, unknown> = await profileRes.json();
          orgId = ((profile.organizations as Array<Record<string, unknown>>)?.[0]?.id as string) || null;
        }
      } catch {}
      return { ok: true, data: { access_token: data.token, _userEmail: data.userEmail, _orgId: orgId } };
    }
    return { ok: false, data: { error: "authorization_pending" } };
  },
  mapTokens: (tokens: Record<string, unknown>): MappedTokens => ({
    accessToken: tokens.access_token as string,
    refreshToken: null,
    expiresIn: null,
    email: tokens._userEmail as string,
    ...(tokens._orgId ? { providerSpecificData: { orgId: tokens._orgId as string } } : {}),
  }),
};

export default kilocode;
