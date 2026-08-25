import open from "open";
import { OAuthService } from "./oauth";
import { CODEX_CONFIG } from "../constants/oauth";
import { getServerCredentials } from "../config/index";
import { startLocalServer } from "../utils/server";
import { generatePKCE } from "../utils/pkce";
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

/**
 * Codex (OpenAI) OAuth Service
 */
export class CodexService extends OAuthService {
  constructor() {
    super(CODEX_CONFIG as { clientId: string; authorizeUrl: string; tokenUrl: string; codeChallengeMethod: string; [key: string]: unknown });
  }

  /**
   * Build Codex authorization URL
   */
  buildCodexAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
    const params: Record<string, string> = {
      response_type: "code",
      client_id: (CODEX_CONFIG as Record<string, string>).clientId,
      redirect_uri: redirectUri,
      scope: (CODEX_CONFIG as Record<string, string>).scope,
      code_challenge: codeChallenge,
      code_challenge_method: (CODEX_CONFIG as Record<string, string>).codeChallengeMethod,
      ...(CODEX_CONFIG as Record<string, Record<string, string>>).extraParams,
      state: state,
    };

    const queryString: string = Object.entries(params)
      .map(([key, value]: [string, string]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");

    return `${(CODEX_CONFIG as Record<string, string>).authorizeUrl}?${queryString}`;
  }

  /**
   * Save Codex tokens to server
   */
  async saveTokens(tokens: TokenResponse): Promise<Record<string, unknown>> {
    const { server, token, userId } = getServerCredentials();

    const response: Response = await fetch(`${server}/api/cli/providers/codex`, {
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
        lastRefreshAt: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const error: Record<string, unknown> = await response.json();
      throw new Error((error.error as string) || "Failed to save tokens");
    }

    return await response.json();
  }

  /**
   * Complete Codex OAuth flow
   */
  async connect(): Promise<boolean> {
    const spinner = createSpinner("Starting Codex OAuth...").start();

    try {
      spinner.text = "Starting local server...";

      const fixedPort: number = (CODEX_CONFIG as Record<string, number>).fixedPort;
      let callbackParams: CallbackParams | null = null;
      const { port, close } = await startLocalServer((params: Record<string, string>) => {
        callbackParams = params as CallbackParams;
      }, fixedPort);

      const redirectUri: string = `http://localhost:${port}/auth/callback`;
      spinner.succeed(`Local server started on port ${port}`);

      const { codeVerifier, codeChallenge, state } = generatePKCE();

      const authUrl: string = this.buildCodexAuthUrl(redirectUri, state, codeChallenge);

      console.log("\nOpening browser for OpenAI authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      await open(authUrl);

      spinner.start("Waiting for OpenAI authorization...");

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

      const tokens: TokenResponse = await this.exchangeCode(callbackParams!.code, redirectUri, codeVerifier, "application/x-www-form-urlencoded");

      spinner.text = "Saving tokens to server...";

      await this.saveTokens(tokens);

      spinner.succeed("Codex connected successfully!");
      return true;
    } catch (error: unknown) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
