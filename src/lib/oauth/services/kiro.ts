import { KIRO_CONFIG, assertValidAwsRegion } from "../constants/oauth";

interface ClientRegistration {
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt: string;
}

interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface PollResult {
  success: boolean;
  error?: string;
  errorDescription?: string;
  pending?: boolean;
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: string;
  };
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  profileArn: string | null;
  expiresIn: number;
}

interface Model {
  id: string;
  name: string;
  description: string;
  rateMultiplier: number;
  rateUnit: string;
  maxInputTokens: number;
}

const KIRO_AUTH_SERVICE: string = "https://prod.us-east-1.auth.desktop.kiro.dev";

/**
 * Kiro OAuth Service
 * Supports multiple authentication methods:
 * 1. AWS Builder ID (Device Code Flow)
 * 2. AWS IAM Identity Center/IDC (Device Code Flow)
 * 3. Google/GitHub Social Login (Authorization Code Flow + Manual Callback)
 * 4. Import Token (Manual refresh token paste)
 */
export class KiroService {
  /**
   * Register OIDC client with AWS SSO
   */
  async registerClient(region: string = "us-east-1"): Promise<ClientRegistration> {
    assertValidAwsRegion(region);
    const endpoint: string = `https://oidc.${region}.amazonaws.com/client/register`;

    const response: Response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientName: (KIRO_CONFIG as Record<string, string>).clientName,
        clientType: (KIRO_CONFIG as Record<string, string>).clientType,
        scopes: (KIRO_CONFIG as Record<string, string[]>).scopes,
        grantTypes: (KIRO_CONFIG as Record<string, string[]>).grantTypes,
        issuerUrl: (KIRO_CONFIG as Record<string, string>).issuerUrl,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to register client: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();
    return {
      clientId: data.clientId as string,
      clientSecret: data.clientSecret as string,
      clientSecretExpiresAt: data.clientSecretExpiresAt as string,
    };
  }

  /**
   * Start device authorization for AWS Builder ID or IDC
   */
  async startDeviceAuthorization(clientId: string, clientSecret: string, startUrl: string, region: string = "us-east-1"): Promise<DeviceAuthorization> {
    assertValidAwsRegion(region);
    const endpoint: string = `https://oidc.${region}.amazonaws.com/device_authorization`;

    const response: Response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        startUrl,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to start device authorization: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();
    return {
      deviceCode: data.deviceCode as string,
      userCode: data.userCode as string,
      verificationUri: data.verificationUri as string,
      verificationUriComplete: data.verificationUriComplete as string,
      expiresIn: data.expiresIn as number,
      interval: (data.interval as number) || 5,
    };
  }

  /**
   * Poll for token using device code (AWS Builder ID/IDC)
   */
  async pollDeviceToken(clientId: string, clientSecret: string, deviceCode: string, region: string = "us-east-1"): Promise<PollResult> {
    assertValidAwsRegion(region);
    const endpoint: string = `https://oidc.${region}.amazonaws.com/token`;

    const response: Response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data: Record<string, unknown> = await response.json();

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error as string,
        errorDescription: data.error_description as string,
        pending: data.error === "authorization_pending" || data.error === "slow_down",
      };
    }

    return {
      success: true,
      tokens: {
        accessToken: data.accessToken as string,
        refreshToken: data.refreshToken as string,
        expiresIn: data.expiresIn as number,
        tokenType: data.tokenType as string,
      },
    };
  }

  /**
   * Build Google/GitHub social login URL
   */
  buildSocialLoginUrl(provider: string, codeChallenge: string, state: string): string {
    const idp: string = provider === "google" ? "Google" : "Github";
    const redirectUri: string = "kiro://kiro.kiroAgent/authenticate-success";
    return `${KIRO_AUTH_SERVICE}/login?idp=${idp}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;
  }

  /**
   * Exchange authorization code for tokens (Social Login)
   */
  async exchangeSocialCode(code: string, codeVerifier: string): Promise<RefreshResult> {
    const redirectUri: string = "kiro://kiro.kiroAgent/authenticate-success";

    const response: Response = await fetch(`${KIRO_AUTH_SERVICE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();
    return {
      accessToken: data.accessToken as string,
      refreshToken: data.refreshToken as string,
      profileArn: (data.profileArn as string) || null,
      expiresIn: (data.expiresIn as number) || 3600,
    };
  }

  /**
   * Refresh token using refresh token
   */
  async refreshToken(refreshToken: string, providerSpecificData: Record<string, unknown> = {}): Promise<RefreshResult> {
    const { clientId, clientSecret, region } = providerSpecificData as { authMethod: string; clientId: string; clientSecret: string; region: string };

    if (clientId && clientSecret) {
      const safeRegion: string = region || "us-east-1";
      assertValidAwsRegion(safeRegion);
      const endpoint: string = `https://oidc.${safeRegion}.amazonaws.com/token`;

      const response: Response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          grantType: "refresh_token",
        }),
      });

      if (!response.ok) {
        const error: string = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const data: Record<string, unknown> = await response.json();
      return {
        accessToken: data.accessToken as string,
        refreshToken: (data.refreshToken as string) || refreshToken,
        profileArn: (data.profileArn as string) || null,
        expiresIn: data.expiresIn as number,
      };
    }

    const response: Response = await fetch(`${KIRO_AUTH_SERVICE}/refreshToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();
    return {
      accessToken: data.accessToken as string,
      refreshToken: (data.refreshToken as string) || refreshToken,
      profileArn: (data.profileArn as string) || null,
      expiresIn: (data.expiresIn as number) || 3600,
    };
  }

  /**
   * Validate and import refresh token
   */
  async validateImportToken(refreshToken: string): Promise<RefreshResult & { authMethod: string }> {
    if (!refreshToken.startsWith("aorAAAAAG")) {
      throw new Error("Invalid token format. Token should start with aorAAAAAG...");
    }

    try {
      const result: RefreshResult = await this.refreshToken(refreshToken);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || refreshToken,
        profileArn: result.profileArn,
        expiresIn: result.expiresIn,
        authMethod: "imported",
      };
    } catch (error: unknown) {
      throw new Error(`Token validation failed: ${(error as Error).message}`);
    }
  }

  /**
   * List available CodeWhisperer profiles for OAuth/IDC tokens
   */
  async listAvailableProfiles(accessToken: string, region: string = "us-east-1"): Promise<string | null> {
    assertValidAwsRegion(region);
    const endpoint: string = `https://codewhisperer.${region}.amazonaws.com`;

    const response: Response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles",
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ maxResults: 10 }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to list profiles: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();
    const profiles: Array<Record<string, unknown>> = Array.isArray(data?.profiles) ? data.profiles as Array<Record<string, unknown>> : [];
    const arnOf = (p: Record<string, unknown>): string | null => (p?.arn as string) || (p?.profileArn as string) || null;
    const match: Record<string, unknown> | undefined = profiles.find((p: Record<string, unknown>) => arnOf(p)?.split(":")[3] === region) || profiles[0];
    return arnOf(match || {});
  }

  /**
   * Validate an API key against the Amazon Q model catalog
   */
  async listAvailableApiKeyModels(apiKey: string, region: string = "us-east-1"): Promise<Record<string, unknown>[]> {
    assertValidAwsRegion(region);
    const params: URLSearchParams = new URLSearchParams({ origin: "AI_EDITOR" });
    const endpoint: string = `https://q.${region}.amazonaws.com/ListAvailableModels?${params}`;
    const response: Response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "TokenType": "API_KEY",
        "Accept": "application/json",
        "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
        "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
      },
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to list API-key models: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();
    const models: Array<Record<string, unknown>> = Array.isArray(data?.models) ? data.models as Array<Record<string, unknown>> : [];
    if (models.length === 0) {
      throw new Error("API key returned no available models");
    }
    return models;
  }

  /**
   * Validate an API-key credential
   */
  async validateApiKey(apiKey: string, region: string = "us-east-1"): Promise<{ accessToken: string; refreshToken: null; profileArn: null; region: string; authMethod: string }> {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      throw new Error("API key is required");
    }
    const trimmed: string = apiKey.trim();

    try {
      await this.listAvailableApiKeyModels(trimmed, region);
    } catch (error: unknown) {
      throw new Error(`API key validation failed: ${(error as Error).message}`);
    }

    return {
      accessToken: trimmed,
      refreshToken: null,
      profileArn: null,
      region,
      authMethod: "api_key",
    };
  }

  /**
   * List available models from CodeWhisperer API
   */
  async listAvailableModels(accessToken: string, profileArn: string): Promise<Model[]> {
    const endpoint: string = "https://codewhisperer.us-east-1.amazonaws.com";
    const target: string = "AmazonCodeWhispererService.ListAvailableModels";

    const response: Response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": target,
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        origin: "AI_EDITOR",
        profileArn,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to list models: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();
    return ((data.models as Array<Record<string, unknown>>) || []).map((m: Record<string, unknown>) => ({
      id: m.modelId as string,
      name: (m.modelName as string) || (m.modelId as string),
      description: m.description as string,
      rateMultiplier: m.rateMultiplier as number,
      rateUnit: m.rateUnit as string,
      maxInputTokens: ((m.tokenLimits as Record<string, number>)?.maxInputTokens) || 0,
    }));
  }

  /**
   * Fetch user email from access token (optional, for display)
   */
  extractEmailFromJWT(accessToken: string): string | null {
    try {
      const parts: string[] = accessToken.split(".");
      if (parts.length !== 3) return null;

      let payload: string = parts[1];
      while (payload.length % 4) {
        payload += "=";
      }

      const decoded: Record<string, unknown> = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return (decoded.email as string) || (decoded.preferred_username as string) || (decoded.sub as string) || null;
    } catch {
      return null;
    }
  }
}
