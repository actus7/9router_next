import crypto from "crypto";
import open from "open";
import { GEMINI_CONFIG, getOAuthClientMetadata } from "../constants/oauth";
import { getServerCredentials } from "../config/index";
import { startLocalServer } from "../utils/server";
import { spinner as createSpinner } from "../utils/ui";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  [key: string]: unknown;
}

interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  [key: string]: string | undefined;
}

/**
 * Gemini CLI (Google Cloud Code Assist) OAuth Service
 * Uses standard OAuth2 Authorization Code flow (no PKCE)
 */
export class GeminiCLIService {
  config: Record<string, unknown>;

  constructor() {
    this.config = GEMINI_CONFIG as Record<string, unknown>;
  }

  /**
   * Build Gemini CLI authorization URL
   */
  buildAuthUrl(redirectUri: string, state: string): string {
    const params: URLSearchParams = new URLSearchParams({
      client_id: this.config.clientId as string,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: (this.config.scopes as string[]).join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
    const response: Response = await fetch(this.config.tokenUrl as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId as string,
        client_secret: this.config.clientSecret as string,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Fetch project ID from Google Cloud Code Assist
   */
  async fetchProjectId(accessToken: string): Promise<string> {
    const response: Response = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "google-api-nodejs-client/9.15.1",
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": JSON.stringify(getOAuthClientMetadata())
        },
        body: JSON.stringify({
          metadata: getOAuthClientMetadata(),
          mode: 1
        })
      }
    );

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to fetch project ID: ${error}`);
    }

    const data: Record<string, unknown> = await response.json();

    let projectId: string = "";
    if (typeof data.cloudaicompanionProject === "string") {
      projectId = (data.cloudaicompanionProject as string).trim();
    } else if ((data.cloudaicompanionProject as Record<string, unknown>)?.id) {
      projectId = ((data.cloudaicompanionProject as Record<string, unknown>).id as string).trim();
    }

    if (!projectId) {
      throw new Error("No project ID found in response");
    }

    return projectId;
  }

  /**
   * Get user info from Google
   */
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    const response: Response = await fetch(`${this.config.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return await response.json();
  }

  /**
   * Save Gemini CLI tokens to server
   */
  async saveTokens(tokens: TokenResponse, userInfo: Record<string, unknown>, projectId: string): Promise<Record<string, unknown>> {
    const { server, token, userId } = getServerCredentials();

    const response: Response = await fetch(`${server}/api/cli/providers/gemini-cli`, {
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
        scope: tokens.scope,
        email: userInfo.email,
        projectId: projectId,
      }),
    });

    if (!response.ok) {
      const error: Record<string, unknown> = await response.json();
      throw new Error((error.error as string) || "Failed to save tokens");
    }

    return await response.json();
  }

  /**
   * Complete Gemini OAuth flow
   */
  async connect(): Promise<boolean> {
    const spinner = createSpinner("Starting Gemini OAuth...").start();

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

      console.log("\nOpening browser for Google authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      await open(authUrl);

      spinner.start("Waiting for Google authorization...");

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

      const userInfo: Record<string, unknown> = await this.getUserInfo(tokens.access_token);

      spinner.text = "Fetching project ID...";

      const projectId: string = await this.fetchProjectId(tokens.access_token);

      spinner.text = "Saving tokens to server...";

      await this.saveTokens(tokens, userInfo, projectId);

      spinner.succeed(`Gemini CLI connected successfully! (${userInfo.email}, Project: ${projectId})`);
      return true;
    } catch (error: unknown) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
