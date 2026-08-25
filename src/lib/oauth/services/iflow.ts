import crypto from "crypto";
import open from "open";
import { IFLOW_CONFIG } from "../constants/oauth";
import { getServerCredentials } from "../config/index";
import { startLocalServer } from "../utils/server";
import { spinner as createSpinner } from "../utils/ui";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  [key: string]: unknown;
}

interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  [key: string]: string | undefined;
}

interface UserInfo {
  apiKey: string;
  email: string;
  phone: string;
  nickname: string;
  name: string;
  [key: string]: unknown;
}

/**
 * iFlow OAuth Service
 * Uses Authorization Code flow with Basic Auth
 */
export class IFlowService {
  config: Record<string, unknown>;

  constructor() {
    this.config = IFLOW_CONFIG as Record<string, unknown>;
  }

  /**
   * Build iFlow authorization URL
   */
  buildAuthUrl(redirectUri: string, state: string): string {
    const params: URLSearchParams = new URLSearchParams({
      loginMethod: (this.config.extraParams as Record<string, string>).loginMethod,
      type: (this.config.extraParams as Record<string, string>).type,
      redirect: redirectUri,
      state: state,
      client_id: this.config.clientId as string,
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
    const basicAuth: string = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const response: Response = await fetch(this.config.tokenUrl as string, {
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
        client_id: this.config.clientId as string,
        client_secret: this.config.clientSecret as string,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get user info from iFlow
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response: Response = await fetch(
      `${this.config.userInfoUrl}?accessToken=${encodeURIComponent(accessToken)}`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    const result: Record<string, unknown> = await response.json();

    if (!result.success) {
      throw new Error("Failed to get user info");
    }

    return result.data as UserInfo;
  }

  /**
   * Save iFlow tokens to server
   */
  async saveTokens(tokens: TokenResponse, userInfo: UserInfo): Promise<Record<string, unknown>> {
    const { server, token, userId } = getServerCredentials();

    const response: Response = await fetch(`${server}/api/cli/providers/iflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        apiKey: userInfo.apiKey,
        email: userInfo.email || userInfo.phone,
      }),
    });

    if (!response.ok) {
      const error: Record<string, unknown> = await response.json();
      throw new Error((error.error as string) || "Failed to save tokens");
    }

    return await response.json();
  }

  /**
   * Complete iFlow OAuth flow
   */
  async connect(): Promise<boolean> {
    const spinner = createSpinner("Starting iFlow OAuth...").start();

    try {
      spinner.text = "Starting local server...";

      let callbackParams: CallbackParams | null = null;
      const { port, close } = await startLocalServer((params: Record<string, string>) => {
        callbackParams = params as CallbackParams;
      });

      const redirectUri: string = `http://localhost:${port}/callback`;
      spinner.succeed(`Local server started on port ${port}`);

      const state: string = crypto.randomBytes(32).toString("base64url");

      const authUrl: string = this.buildAuthUrl(redirectUri, state);

      console.log("\nOpening browser for iFlow authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      await open(authUrl);

      spinner.start("Waiting for iFlow authorization...");

      await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
        const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
          reject(new Error("Authentication timeout (5 minutes)"));
        }, 300000);

        const checkInterval: ReturnType<typeof setInterval> = setInterval(() => {
          if (callbackParams) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });

      close();

      if (callbackParams!.error) {
        throw new Error(callbackParams!.error_description || callbackParams!.error);
      }

      if (!callbackParams!.code) {
        throw new Error("No authorization code received");
      }

      spinner.start("Exchanging code for tokens...");

      const tokens: TokenResponse = await this.exchangeCode(callbackParams!.code, redirectUri);

      spinner.text = "Fetching user info...";

      const userInfo: UserInfo = await this.getUserInfo(tokens.access_token);

      spinner.text = "Saving tokens to server...";

      await this.saveTokens(tokens, userInfo);

      spinner.succeed(`iFlow connected successfully! (${userInfo.email || userInfo.phone})`);
      return true;
    } catch (error: unknown) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
