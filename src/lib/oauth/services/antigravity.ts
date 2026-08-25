import crypto from "crypto";
import open from "open";
import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth";
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

interface LoadCodeAssistResult {
  projectId: string;
  tierId: string;
  raw: Record<string, unknown>;
}

interface OnboardResult {
  success: boolean;
  projectId: string;
}

/**
 * Antigravity OAuth Service
 * Uses standard OAuth2 Authorization Code flow (similar to Gemini)
 */
export class AntigravityService {
  config: Record<string, unknown>;

  constructor() {
    this.config = ANTIGRAVITY_CONFIG as Record<string, unknown>;
  }

  /**
   * Build Antigravity authorization URL
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
   * Get common headers for Antigravity API calls
   */
  getApiHeaders(accessToken: string): Record<string, string> {
    return {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": this.config.loadCodeAssistUserAgent as string,
    };
  }

  /**
   * Get metadata object for loadCodeAssist / onboardUser API calls.
   */
  getMetadata(): { ideType: number; platform: number; pluginType: number } {
    return getOAuthClientMetadata();
  }

  /**
   * Fetch Project ID and Tier from loadCodeAssist API
   */
  async loadCodeAssist(accessToken: string): Promise<LoadCodeAssistResult> {
    const response: Response = await fetch(this.config.loadCodeAssistEndpoint as string, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ metadata: this.getMetadata() }),
    });

    if (!response.ok) {
      const errorText: string = await response.text();
      throw new Error(`Failed to load code assist: ${errorText}`);
    }

    const data: Record<string, unknown> = await response.json();

    let projectId: string = data.cloudaicompanionProject as string;
    if (typeof projectId === 'object' && projectId !== null && (projectId as Record<string, unknown>).id) {
      projectId = (projectId as Record<string, unknown>).id as string;
    }

    let tierId: string = "legacy-tier";
    if (Array.isArray(data.allowedTiers)) {
      for (const tier of data.allowedTiers) {
        if (tier.isDefault && tier.id) {
          tierId = tier.id.trim();
          break;
        }
      }
    }

    return { projectId, tierId, raw: data };
  }

  /**
   * Onboard user to enable Gemini Code Assist for the project
   */
  async onboardUser(accessToken: string, projectId: string, tierId: string): Promise<Record<string, unknown>> {
    const response: Response = await fetch(this.config.onboardUserEndpoint as string, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ tierId, metadata: this.getMetadata() }),
    });

    if (!response.ok) {
      const errorText: string = await response.text();
      throw new Error(`Failed to onboard user: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Complete onboarding flow with retry
   */
  async completeOnboarding(accessToken: string, projectId: string, tierId: string, maxRetries: number = 10): Promise<OnboardResult> {
    for (let i = 0; i < maxRetries; i++) {
      const result: Record<string, unknown> = await this.onboardUser(accessToken, projectId, tierId);

      if (result.done === true) {
        let finalProjectId: string = projectId;
        if (result.response?.cloudaicompanionProject) {
          const respProject: unknown = (result.response as Record<string, unknown>).cloudaicompanionProject;
          if (typeof respProject === 'string') {
            finalProjectId = respProject.trim();
          } else if ((respProject as Record<string, unknown>).id) {
            finalProjectId = ((respProject as Record<string, unknown>).id as string).trim();
          }
        }
        return { success: true, projectId: finalProjectId };
      }

      await new Promise<void>((resolve: () => void) => setTimeout(resolve, 5000));
    }

    throw new Error("Onboarding timeout - please try again");
  }

  /**
   * Fetch Project ID from loadCodeAssist API (legacy method for compatibility)
   */
  async fetchProjectId(accessToken: string): Promise<string> {
    const { projectId } = await this.loadCodeAssist(accessToken);
    if (!projectId) {
      throw new Error("No cloudaicompanionProject found in response");
    }
    return projectId;
  }

  /**
   * Save Antigravity tokens to server
   */
  async saveTokens(tokens: TokenResponse, userInfo: Record<string, unknown>, projectId: string): Promise<Record<string, unknown>> {
    const { server, token, userId } = getServerCredentials();

    const response: Response = await fetch(`${server}/api/cli/providers/antigravity`, {
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
   * Complete Antigravity OAuth flow
   */
  async connect(): Promise<boolean> {
    const spinner = createSpinner("Starting Antigravity OAuth...").start();

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

      console.log("\nOpening browser for Antigravity authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      await open(authUrl);

      spinner.start("Waiting for Antigravity authorization...");

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

      spinner.text = "Loading Code Assist configuration...";

      const { projectId, tierId } = await this.loadCodeAssist(tokens.access_token);

      if (!projectId) {
        throw new Error("No Google Cloud Project found. Please ensure you have a GCP project with Gemini Code Assist enabled.");
      }

      spinner.text = "Onboarding to Gemini Code Assist...";

      const onboardResult: OnboardResult = await this.completeOnboarding(tokens.access_token, projectId, tierId);
      const finalProjectId: string = onboardResult.projectId || projectId;

      spinner.text = "Saving tokens to server...";

      await this.saveTokens(tokens, userInfo, finalProjectId);

      spinner.succeed(`Antigravity connected successfully! (${userInfo.email}, Project: ${finalProjectId})`);
      return true;
    } catch (error: unknown) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
