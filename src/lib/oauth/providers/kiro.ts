import { KIRO_CONFIG, assertValidAwsRegion } from "../constants/oauth";
import { extractEmailFromAccessToken } from "../providerHelpers";

interface ProviderConfig {
  clientName: string;
  clientType: string;
  scopes: string[];
  grantTypes: string[];
  issuerUrl: string;
  startUrl: string;
  [key: string]: unknown;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  _clientId: string;
  _clientSecret: string;
  _region: string;
  _authMethod: string;
  _startUrl: string;
}

interface PollResult {
  ok: boolean;
  data: Record<string, unknown>;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email: string | undefined;
  providerSpecificData: {
    profileArn: string | null;
    clientId: string;
    clientSecret: string;
    region: string;
    authMethod: string;
    startUrl: string;
  };
}

const kiro = {
  config: KIRO_CONFIG as ProviderConfig,
  flowType: "device_code",
  requestDeviceCode: async (config: ProviderConfig, codeChallenge: string, options: Record<string, unknown> = {}): Promise<DeviceCodeResponse> => {
    const trimmedRegion: string = typeof options.region === "string" ? (options.region as string).trim() : "";
    const region: string = trimmedRegion || "us-east-1";
    assertValidAwsRegion(region);
    const trimmedStartUrl: string = typeof options.startUrl === "string" ? (options.startUrl as string).trim() : "";
    const startUrl: string = trimmedStartUrl || config.startUrl;
    const authMethod: string = options.authMethod === "idc" ? "idc" : "builder-id";
    const registerClientUrl: string = `https://oidc.${region}.amazonaws.com/client/register`;
    const deviceAuthUrl: string = `https://oidc.${region}.amazonaws.com/device_authorization`;

    const registerRes: Response = await fetch(registerClientUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientName: config.clientName,
        clientType: config.clientType,
        scopes: config.scopes,
        grantTypes: config.grantTypes,
        issuerUrl: config.issuerUrl,
      }),
    });

    if (!registerRes.ok) {
      const error: string = await registerRes.text();
      throw new Error(`Client registration failed: ${error}`);
    }

    const clientInfo: Record<string, unknown> = await registerRes.json();

    const deviceRes: Response = await fetch(deviceAuthUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientId: clientInfo.clientId,
        clientSecret: clientInfo.clientSecret,
        startUrl,
      }),
    });

    if (!deviceRes.ok) {
      const error: string = await deviceRes.text();
      throw new Error(`Device authorization failed: ${error}`);
    }

    const deviceData: Record<string, unknown> = await deviceRes.json();

    return {
      device_code: deviceData.deviceCode as string,
      user_code: deviceData.userCode as string,
      verification_uri: deviceData.verificationUri as string,
      verification_uri_complete: deviceData.verificationUriComplete as string,
      expires_in: deviceData.expiresIn as number,
      interval: (deviceData.interval as number) || 5,
      _clientId: clientInfo.clientId as string,
      _clientSecret: clientInfo.clientSecret as string,
      _region: region,
      _authMethod: authMethod,
      _startUrl: startUrl,
    };
  },
  pollToken: async (config: ProviderConfig, deviceCode: string, codeVerifier: string, extraData: Record<string, unknown>): Promise<PollResult> => {
    const region: string = (extraData?._region as string) || "us-east-1";
    assertValidAwsRegion(region);
    const tokenUrl: string = `https://oidc.${region}.amazonaws.com/token`;
    const response: Response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientId: extraData?._clientId,
        clientSecret: extraData?._clientSecret,
        deviceCode: deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch  {
      const text: string = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    if (data.accessToken) {
      return {
        ok: true,
        data: {
          access_token: data.accessToken,
          refresh_token: data.refreshToken,
          expires_in: data.expiresIn,
          profile_arn: data?.profileArn || null,
          _clientId: extraData?._clientId,
          _clientSecret: extraData?._clientSecret,
          _region: extraData?._region,
          _authMethod: extraData?._authMethod,
          _startUrl: extraData?._startUrl,
        },
      };
    }

    return {
      ok: false,
      data: {
        error: data.error || "authorization_pending",
        error_description: data.error_description || data.message,
      },
    };
  },
  mapTokens: (tokens: Record<string, unknown>): MappedTokens => {
    const email: string | undefined = extractEmailFromAccessToken(tokens.access_token as string);
    const mapped: MappedTokens = {
      accessToken: tokens.access_token as string,
      refreshToken: tokens.refresh_token as string,
      expiresIn: tokens.expires_in as number,
      email,
      providerSpecificData: {
        profileArn: (tokens?.profile_arn as string) || null,
        clientId: tokens._clientId as string,
        clientSecret: tokens._clientSecret as string,
        region: (tokens._region as string) || "us-east-1",
        authMethod: (tokens._authMethod as string) || "builder-id",
        startUrl: (tokens._startUrl as string) || (KIRO_CONFIG as ProviderConfig).startUrl,
      },
    };
    return mapped;
  },
};

export default kiro;
