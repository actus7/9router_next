import crypto from "crypto";
import { XAI_CONFIG, XAI_PKCE_VERIFIER_BYTES } from "../constants/xai";
import { validateXaiOAuthEndpoint, decodeXaiIdTokenEmail } from "../providerHelpers";

interface ProviderConfig {
  clientId: string;
  scope: string;
  codeChallengeMethod: string;
  authorizeUrl: string;
  tokenUrl: string;
  discoveryUrl: string;
  loopbackPort: number;
  callbackPath: string;
  [key: string]: unknown;
}

interface DiscoveryEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
}

let cachedXaiDiscovery: DiscoveryEndpoints | null = null;

async function discoverXaiEndpoints(): Promise<DiscoveryEndpoints> {
  if (cachedXaiDiscovery) return cachedXaiDiscovery;
  try {
    const res: Response = await fetch((XAI_CONFIG as ProviderConfig).discoveryUrl, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data: Record<string, unknown> = await res.json();
      cachedXaiDiscovery = {
        authorizeUrl: validateXaiOAuthEndpoint(data.authorization_endpoint as string, "authorization_endpoint"),
        tokenUrl: validateXaiOAuthEndpoint(data.token_endpoint as string, "token_endpoint"),
      };
      return cachedXaiDiscovery;
    }
  } catch { /* fall through to static fallback */ }
  cachedXaiDiscovery = { authorizeUrl: (XAI_CONFIG as ProviderConfig).authorizeUrl, tokenUrl: (XAI_CONFIG as ProviderConfig).tokenUrl };
  return cachedXaiDiscovery;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  email?: string;
  providerSpecificData?: {
    idToken: string;
  };
}

const xai = {
  config: XAI_CONFIG as ProviderConfig,
  flowType: "authorization_code_pkce",
  fixedPort: (XAI_CONFIG as ProviderConfig).loopbackPort,
  callbackPath: (XAI_CONFIG as ProviderConfig).callbackPath,
  pkceVerifierBytes: XAI_PKCE_VERIFIER_BYTES,
  prepareConfig: async (config: ProviderConfig): Promise<ProviderConfig> => {
    const endpoints: DiscoveryEndpoints = await discoverXaiEndpoints();
    return {
      ...config,
      authorizeUrl: endpoints.authorizeUrl,
      tokenUrl: endpoints.tokenUrl,
    };
  },
  buildAuthUrl: (config: ProviderConfig, redirectUri: string, state: string, codeChallenge: string): string => {
    const nonce: string = crypto.randomBytes(16).toString("hex");
    const params: Record<string, string> = {
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      state,
      nonce,
      plan: "generic",
      referrer: "cli-proxy-api",
    };
    const qs: string = Object.entries(params)
      .map(([k, v]: [string, string]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `${config.authorizeUrl}?${qs}`;
  },
  exchangeToken: async (config: ProviderConfig, code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> => {
    const response: Response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!response.ok) {
      const error: string = await response.text();
      throw new Error(`xAI token exchange failed: ${error}`);
    }
    return await response.json();
  },
  mapTokens: (tokens: TokenResponse): MappedTokens => {
    const mapped: MappedTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
    };
    const email: string | undefined = decodeXaiIdTokenEmail(tokens.id_token || "");
    if (email) mapped.email = email;
    if (tokens.id_token) {
      mapped.providerSpecificData = { idToken: tokens.id_token };
    }
    return mapped;
  },
};

export default xai;
