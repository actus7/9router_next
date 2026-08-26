import open from "open";
import { OAuthService } from "./oauth";
import crypto from "crypto";
import { XAI_CONFIG, XAI_PKCE_VERIFIER_BYTES } from "../constants/xai";
import { startLocalServer } from "../utils/server";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../utils/pkce";
import { spinner as createSpinner } from "../utils/ui";

const BASE64_BLOCK_SIZE: number = 4;

let cachedDiscovery: { authorizeUrl: string; tokenUrl: string } | null = null;

function validateOAuthEndpoint(rawUrl: string, field: string): string {
  const value: string = String(rawUrl || "").trim();
  if (!value) throw new Error(`xai discovery ${field} is empty`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (err: unknown) {
    throw new Error(`xai discovery ${field} is invalid: ${(err as Error).message}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`xai discovery ${field} must use https: ${value}`);
  }

  const host: string = parsed.hostname.toLowerCase().trim();
  if (host !== "x.ai" && !host.endsWith(".x.ai")) {
    throw new Error(`xai discovery ${field} host ${host} is not on x.ai`);
  }

  return value;
}

/**
 * Discover authorization + token endpoints. Cached process-wide.
 */
async function discoverEndpoints(): Promise<{ authorizeUrl: string; tokenUrl: string }> {
  if (cachedDiscovery) return cachedDiscovery;

  try {
    const res: Response = await fetch((XAI_CONFIG as Record<string, string>).discoveryUrl, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data: Record<string, unknown> = await res.json();
      cachedDiscovery = {
        authorizeUrl: validateOAuthEndpoint(data.authorization_endpoint as string, "authorization_endpoint"),
        tokenUrl: validateOAuthEndpoint(data.token_endpoint as string, "token_endpoint"),
      };
      return cachedDiscovery;
    }
  } catch {
    // fall through to static fallback
  }

  cachedDiscovery = {
    authorizeUrl: (XAI_CONFIG as Record<string, string>).authorizeUrl,
    tokenUrl: (XAI_CONFIG as Record<string, string>).tokenUrl,
  };
  return cachedDiscovery;
}

/**
 * Decode the `email` claim from an id_token JWT.
 */
function decodeIdTokenEmail(idToken: string): string | undefined {
  if (!idToken || typeof idToken !== "string") return undefined;
  const parts: string[] = idToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const base64: string = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding: number = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const json: string = Buffer.from(base64 + "=".repeat(padding), "base64").toString("utf8");
    const payload: Record<string, unknown> = JSON.parse(json);
    return (payload.email as string) || (payload.preferred_username as string) || (payload.sub as string) || undefined;
  } catch {
    return undefined;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  [key: string]: unknown;
}

interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  [key: string]: string | undefined;
}

class XaiService extends OAuthService {
  constructor() {
    super(XAI_CONFIG as { clientId: string; authorizeUrl: string; tokenUrl: string; codeChallengeMethod: string; [key: string]: unknown });
  }

  /**
   * Build xAI authorization URL. Spaces in scope are encoded as %20.
   */
  buildXaiAuthUrl(redirectUri: string, state: string, codeChallenge: string, authorizeUrl: string): string {
    const nonce: string = crypto.randomBytes(16).toString("hex");
    const params: Record<string, string> = {
      response_type: "code",
      client_id: (XAI_CONFIG as Record<string, string>).clientId,
      redirect_uri: redirectUri,
      scope: (XAI_CONFIG as Record<string, string>).scope,
      code_challenge: codeChallenge,
      code_challenge_method: (XAI_CONFIG as Record<string, string>).codeChallengeMethod,
      state,
      nonce,
      plan: "generic",
      referrer: "cli-proxy-api",
    };
    const qs: string = Object.entries(params)
      .map(([k, v]: [string, string]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `${authorizeUrl}?${qs}`;
  }

  /**
   * Exchange authorization code for tokens.
   */
  async exchangeXaiCode({ tokenUrl, code, redirectUri, codeVerifier }: { tokenUrl: string; code: string; redirectUri: string; codeVerifier: string }): Promise<TokenResponse> {
    const res: Response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: (XAI_CONFIG as Record<string, string>).clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!res.ok) {
      const err: string = await res.text();
      throw new Error(`xAI token exchange failed: ${err}`);
    }
    return await res.json();
  }

  /**
   * Refresh an access token using a refresh_token.
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const { tokenUrl } = await discoverEndpoints();
    const res: Response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: (XAI_CONFIG as Record<string, string>).clientId,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      const err: string = await res.text();
      throw new Error(`xAI token refresh failed: ${err}`);
    }
    return await res.json();
  }

  /**
   * Complete xAI OAuth flow end-to-end (CLI entrypoint).
   */
  async connect(): Promise<{ tokens: TokenResponse; email: string | undefined }> {
    const spinner = createSpinner("Starting xAI OAuth...").start();
    try {
      spinner.text = "Discovering xAI endpoints...";
      const { authorizeUrl, tokenUrl } = await discoverEndpoints();

      spinner.text = `Starting local server on port ${(XAI_CONFIG as Record<string, number>).loopbackPort}...`;
      let callbackParams: CallbackParams | null = null;
      const { port, close } = await startLocalServer((params: Record<string, string>) => {
        callbackParams = params as CallbackParams;
      }, (XAI_CONFIG as Record<string, number>).loopbackPort);
      const redirectUri: string = `http://127.0.0.1:${port}${(XAI_CONFIG as Record<string, string>).callbackPath}`;
      spinner.succeed(`Local server started on port ${port}`);

      const codeVerifier: string = generateCodeVerifier(XAI_PKCE_VERIFIER_BYTES);
      const codeChallenge: string = generateCodeChallenge(codeVerifier);
      const state: string = generateState();
      const authUrl: string = this.buildXaiAuthUrl(redirectUri, state, codeChallenge, authorizeUrl);

      console.error("\nOpening browser for xAI authentication...");
      console.error(`If browser doesn't open, visit:\n${authUrl}\n`);
      await open(authUrl);

      spinner.start("Waiting for xAI authorization...");
      await new Promise<void>((resolve: () => void, reject: (reason: Error) => void) => {
        const timeout: ReturnType<typeof setTimeout> = setTimeout(() => reject(new Error("Authentication timeout (5 minutes)")), 300000);
        const iv: ReturnType<typeof setInterval> = setInterval(() => {
          if (callbackParams) {
            clearInterval(iv);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });
      close();

      if (callbackParams!.error) {
        throw new Error(callbackParams!.error_description || callbackParams!.error);
      }
      if (!callbackParams!.code) throw new Error("No authorization code received");
      if (callbackParams!.state !== state) throw new Error("Invalid state parameter");

      spinner.start("Exchanging code for tokens...");
      const tokens: TokenResponse = await this.exchangeXaiCode({
        tokenUrl,
        code: callbackParams!.code,
        redirectUri,
        codeVerifier,
      });

      const email: string | undefined = decodeIdTokenEmail(tokens.id_token || "");
      spinner.succeed("xAI connected successfully!");
      return { tokens, email };
    } catch (error: unknown) {
      spinner.fail(`Failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
