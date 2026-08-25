import open from "open";
import { startLocalServer } from "../utils/server";
import { generatePKCE } from "../utils/pkce";
import { spinner as createSpinner } from "../utils/ui";
import { OAUTH_TIMEOUT } from "../constants/oauth";

interface OAuthConfig {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  codeChallengeMethod: string;
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
 * Generic OAuth Authorization Code Flow with PKCE
 */
export class OAuthService {
  config: OAuthConfig;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  /**
   * Build authorization URL
   */
  buildAuthUrl(redirectUri: string, state: string, codeChallenge: string, extraParams: Record<string, string> = {}): string {
    const params: URLSearchParams = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: this.config.codeChallengeMethod,
      ...extraParams,
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Start local server and wait for callback
   */
  async startAuthFlow(authUrl: string | null, providerName: string): Promise<{
    redirectUri: string;
    port: number;
    close: () => void;
    waitForCallback: () => Promise<CallbackParams>;
  }> {
    const spinner = createSpinner("Starting local server...").start();

    let callbackParams: CallbackParams | null = null;
    const { port, close } = await startLocalServer((params: Record<string, string>) => {
      callbackParams = params as CallbackParams;
    });

    const redirectUri: string = `http://localhost:${port}/callback`;
    spinner.succeed(`Local server started on port ${port}`);

    return {
      redirectUri,
      port,
      close,
      waitForCallback: async (): Promise<CallbackParams> => {
        spinner.start(`Waiting for ${providerName} authorization...`);

        await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
          const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
            reject(new Error("Authentication timeout (5 minutes)"));
          }, OAUTH_TIMEOUT);

          const checkInterval: ReturnType<typeof setInterval> = setInterval(() => {
            if (callbackParams) {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              resolve();
            }
          }, 100);
        });

        spinner.stop();
        close();

        if (callbackParams!.error) {
          throw new Error(callbackParams!.error_description || callbackParams!.error);
        }

        if (!callbackParams!.code) {
          throw new Error("No authorization code received");
        }

        return callbackParams!;
      },
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, redirectUri: string, codeVerifier: string, contentType: string = "application/x-www-form-urlencoded"): Promise<Record<string, unknown>> {
    const body: string | URLSearchParams =
      contentType === "application/json"
        ? JSON.stringify({
            grant_type: "authorization_code",
            client_id: this.config.clientId,
            code: code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          })
        : new URLSearchParams({
            grant_type: "authorization_code",
            client_id: this.config.clientId,
            code: code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          });

    const response: Response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body: body,
    });

    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  /**
   * Complete OAuth flow
   */
  async authenticate(providerName: string, buildAuthUrlFn: (redirectUri: string, state: string, codeChallenge: string) => string): Promise<{
    code: string;
    state: string;
    codeVerifier: string;
    redirectUri: string;
  }> {
    const { codeVerifier, codeChallenge, state } = generatePKCE();

    const { redirectUri, waitForCallback } = await this.startAuthFlow(null, providerName);

    const authUrl: string = buildAuthUrlFn(redirectUri, state, codeChallenge);

    console.log(`\nOpening browser for ${providerName} authentication...`);
    console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

    await open(authUrl);

    const callbackParams: CallbackParams = await waitForCallback();

    if (callbackParams.state !== state) {
      throw new Error("Invalid state parameter");
    }

    return {
      code: callbackParams.code!,
      state: callbackParams.state!,
      codeVerifier,
      redirectUri,
    };
  }
}
