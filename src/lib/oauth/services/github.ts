import { OAuthService } from "./oauth";
import { GITHUB_CONFIG } from "../constants/oauth";
import { spinner as createSpinner } from "../utils/ui";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  [key: string]: unknown;
}

interface CopilotTokenResponse {
  token: string;
  expires_at: string;
  [key: string]: unknown;
}

interface UserInfo {
  id: number;
  login: string;
  name: string;
  email: string;
  [key: string]: unknown;
}

interface AuthResult {
  accessToken: string;
  copilotToken: string;
  refreshToken: null;
  expiresIn: string;
  userInfo: {
    id: number;
    login: string;
    name: string;
    email: string;
  };
  copilotTokenInfo: CopilotTokenResponse;
}

/**
 * GitHub Copilot OAuth Service
 * Uses Device Code Flow for authentication
 */
export class GitHubService extends OAuthService {
  constructor() {
    super(GITHUB_CONFIG as { clientId: string; authorizeUrl: string; tokenUrl: string; codeChallengeMethod: string; [key: string]: unknown });
  }

  /**
   * Get device code for GitHub authentication
   */
  async getDeviceCode(): Promise<DeviceCodeResponse> {
    const response: Response = await fetch(`${(GITHUB_CONFIG as Record<string, string>).deviceCodeUrl}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: (GITHUB_CONFIG as Record<string, string>).clientId,
        scope: (GITHUB_CONFIG as Record<string, string>).scopes,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to get device code: ${error}`);
    }

    return await response.json();
  }

  /**
   * Poll for access token using device code
   */
  async pollAccessToken(deviceCode: string, verificationUri: string, userCode: string, interval: number = 5000): Promise<TokenResponse> {
    const spinner = createSpinner("Waiting for GitHub authentication...").start();
    
    console.log(`\nPlease visit: ${verificationUri}`);
    console.log(`Enter code: ${userCode}\n`);
    
    try {
      const openModule = (await import("open")).default;
      await openModule(verificationUri);
    } catch (error: unknown) {
      console.log("Could not open browser automatically. Please visit the URL above manually.");
    }

    while (true) {
      await new Promise<void>((resolve: () => void) => setTimeout(resolve, interval));

      const response: Response = await fetch(`${(GITHUB_CONFIG as Record<string, string>).tokenUrl}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: (GITHUB_CONFIG as Record<string, string>).clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data: Record<string, unknown> = await response.json();

      if (data.access_token) {
        spinner.succeed("GitHub authentication successful!");
        return {
          access_token: data.access_token as string,
          token_type: data.token_type as string,
          scope: data.scope as string,
        };
      } else if (data.error === "authorization_pending") {
        continue;
      } else if (data.error === "slow_down") {
        interval += 5000;
        continue;
      } else if (data.error === "expired_token") {
        spinner.fail("Device code expired. Please try again.");
        throw new Error("Device code expired");
      } else if (data.error === "access_denied") {
        spinner.fail("Access denied by user.");
        throw new Error("Access denied");
      } else {
        spinner.fail("Failed to get access token.");
        throw new Error((data.error_description as string) || (data.error as string));
      }
    }
  }

  /**
   * Get Copilot token using GitHub access token
   */
  async getCopilotToken(accessToken: string): Promise<CopilotTokenResponse> {
    const response: Response = await fetch(`${(GITHUB_CONFIG as Record<string, string>).copilotTokenUrl}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": (GITHUB_CONFIG as Record<string, string>).apiVersion,
        "User-Agent": (GITHUB_CONFIG as Record<string, string>).userAgent,
      },
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to get Copilot token: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get user info using GitHub access token
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response: Response = await fetch(`${(GITHUB_CONFIG as Record<string, string>).userInfoUrl}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-GitHub-Api-Version": (GITHUB_CONFIG as Record<string, string>).apiVersion,
        "User-Agent": (GITHUB_CONFIG as Record<string, string>).userAgent,
      },
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return await response.json();
  }

  /**
   * Complete GitHub Copilot authentication flow
   */
  async authenticate(): Promise<AuthResult> {
    try {
      const deviceResponse: DeviceCodeResponse = await this.getDeviceCode();
      
      const tokenResponse: TokenResponse = await this.pollAccessToken(
        deviceResponse.device_code, 
        deviceResponse.verification_uri, 
        deviceResponse.user_code
      );
      
      const copilotToken: CopilotTokenResponse = await this.getCopilotToken(tokenResponse.access_token);
      
      const userInfo: UserInfo = await this.getUserInfo(tokenResponse.access_token);
      
      console.log(`\n✅ Successfully authenticated as ${userInfo.login}`);
      
      return {
        accessToken: tokenResponse.access_token,
        copilotToken: copilotToken.token,
        refreshToken: null,
        expiresIn: copilotToken.expires_at,
        userInfo: {
          id: userInfo.id,
          login: userInfo.login,
          name: userInfo.name,
          email: userInfo.email,
        },
        copilotTokenInfo: copilotToken,
      };
    } catch (error: unknown) {
      throw new Error(`GitHub authentication failed: ${(error as Error).message}`);
    }
  }

  /**
   * Connect to server with GitHub credentials
   */
  async connect(): Promise<void> {
    try {
      const authResult: AuthResult = await this.authenticate();
      
      const { server, token, userId } = await import("../config/index").then((m: { getServerCredentials: () => { server: string; token: string; userId: string } }) => m.getServerCredentials());
      const spinner = (await import("../utils/ui")).spinner("Connecting to server...").start();
      
      const response: Response = await fetch(`${server}/api/cli/providers/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-User-Id": userId,
        },
        body: JSON.stringify({
          accessToken: authResult.accessToken,
          copilotToken: authResult.copilotToken,
          userInfo: authResult.userInfo,
          copilotTokenInfo: authResult.copilotTokenInfo,
        }),
      });
      
      if (!response.ok) {
        const errorData: Record<string, unknown> = await response.json();
        throw new Error((errorData.error as string) || "Failed to connect to server");
      }
      
      spinner.succeed("GitHub Copilot connected successfully!");
      console.log(`\nConnected as: ${authResult.userInfo.login}`);
    } catch (error: unknown) {
      const { error: showError } = await import("../utils/ui");
      showError(`GitHub connection failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
