import { OAuthService } from "./oauth";
import { CLAUDE_CONFIG } from "../constants/oauth";
import { getServerCredentials } from "../config/index";
import { spinner as createSpinner } from "../utils/ui";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  [key: string]: unknown;
}

/**
 * Claude OAuth Service
 */
export class ClaudeService extends OAuthService {
  constructor() {
    super(CLAUDE_CONFIG as { clientId: string; authorizeUrl: string; tokenUrl: string; codeChallengeMethod: string; [key: string]: unknown });
  }

  /**
   * Build Claude authorization URL
   */
  buildClaudeAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
    const scopeStr: string = (CLAUDE_CONFIG as Record<string, string[]>).scopes.join(" ");
    const params: URLSearchParams = new URLSearchParams({
      code: "true",
      client_id: (CLAUDE_CONFIG as Record<string, string>).clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopeStr,
      code_challenge: codeChallenge,
      code_challenge_method: (CLAUDE_CONFIG as Record<string, string>).codeChallengeMethod,
      state: state,
    });

    return `${(CLAUDE_CONFIG as Record<string, string>).authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange Claude authorization code (with special handling)
   */
  async exchangeClaudeCode(code: string, redirectUri: string, codeVerifier: string, state: string): Promise<TokenResponse> {
    let authCode: string = code;
    let codeState: string = "";
    if (authCode.includes("#")) {
      const parts: string[] = authCode.split("#");
      authCode = parts[0];
      codeState = parts[1] || "";
    }

    const tokenPayload: Record<string, string> = {
      code: authCode,
      state: codeState || state,
      grant_type: "authorization_code",
      client_id: (CLAUDE_CONFIG as Record<string, string>).clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    };

    const response: Response = await fetch((CLAUDE_CONFIG as Record<string, string>).tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(tokenPayload),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Save Claude tokens to server
   */
  async saveTokens(tokens: TokenResponse): Promise<Record<string, unknown>> {
    const { server, token, userId } = getServerCredentials();

    const response: Response = await fetch(`${server}/api/cli/providers/claude`, {
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
      }),
    });

    if (!response.ok) {
      const error: Record<string, unknown> = await response.json();
      throw new Error((error.error as string) || "Failed to save tokens");
    }

    return await response.json();
  }

  /**
   * Complete Claude OAuth flow
   */
  async connect(): Promise<boolean> {
    const spinner = createSpinner("Starting Claude OAuth...").start();

    try {
      spinner.text = "Starting local server...";

      const { code, state, codeVerifier, redirectUri } = await this.authenticate(
        "Claude",
        this.buildClaudeAuthUrl.bind(this)
      );

      spinner.start("Exchanging code for tokens...");

      const tokens: TokenResponse = await this.exchangeClaudeCode(code, redirectUri, codeVerifier, state);

      spinner.text = "Saving tokens to server...";

      await this.saveTokens(tokens);

      spinner.succeed("Claude connected successfully!");
      return true;
    } catch (error: unknown) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
