import { OAuthService } from "./oauth";
import { OPENAI_CONFIG } from "../constants/oauth";
import { getServerCredentials } from "../config/index";
import { spinner as createSpinner } from "../utils/ui";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token: string;
  scope: string;
  [key: string]: unknown;
}

/**
 * OpenAI OAuth Service (Native)
 * Uses Authorization Code Flow with PKCE (similar to Codex)
 */
export class OpenAIService extends OAuthService {
  constructor() {
    super(OPENAI_CONFIG as { clientId: string; authorizeUrl: string; tokenUrl: string; codeChallengeMethod: string; [key: string]: unknown });
  }

  /**
   * Build OpenAI authorization URL
   */
  buildOpenAIAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
    const params: URLSearchParams = new URLSearchParams({
      client_id: (OPENAI_CONFIG as Record<string, string>).clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: (OPENAI_CONFIG as Record<string, string>).scope,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: (OPENAI_CONFIG as Record<string, string>).codeChallengeMethod,
      ...(OPENAI_CONFIG as Record<string, Record<string, string>>).extraParams,
    });

    return `${(OPENAI_CONFIG as Record<string, string>).authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange OpenAI authorization code for tokens
   */
  async exchangeOpenAICode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> {
    const response: Response = await fetch((OPENAI_CONFIG as Record<string, string>).tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: (OPENAI_CONFIG as Record<string, string>).clientId,
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Save OpenAI tokens to server
   */
  async saveTokens(tokens: TokenResponse): Promise<Record<string, unknown>> {
    const { server, token, userId } = getServerCredentials();

    const response: Response = await fetch(`${server}/api/cli/providers/openai`, {
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
        idToken: tokens.id_token,
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
   * Complete OpenAI OAuth flow
   */
  async connect(): Promise<boolean> {
    const spinner = createSpinner("Starting OpenAI OAuth...").start();

    try {
      spinner.text = "Starting local server...";

      const { code, codeVerifier, redirectUri } = await this.authenticate(
        "OpenAI",
        this.buildOpenAIAuthUrl.bind(this)
      );

      spinner.start("Exchanging code for tokens...");

      const tokens: TokenResponse = await this.exchangeOpenAICode(code, redirectUri, codeVerifier);

      spinner.text = "Saving tokens to server...";

      await this.saveTokens(tokens);

      spinner.succeed("OpenAI connected successfully!");
      return true;
    } catch (error: unknown) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
