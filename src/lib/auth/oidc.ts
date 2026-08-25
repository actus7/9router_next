import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { getSettings } from "@/lib/localDb";

export const OIDC_COOKIE_NAMES: Record<string, string> = {
  state: "oidc_state",
  nonce: "oidc_nonce",
  verifier: "oidc_code_verifier",
};

const DEFAULT_SCOPES: string = "openid profile email";
const DEFAULT_LOGIN_LABEL: string = "Sign in with OIDC";

function trimTrailingSlashes(value: string | undefined | null): string {
  return (value || "").trim().replace(/\/+$/, "");
}

function normalizeScopes(value: string | undefined | null): string {
  return (value || DEFAULT_SCOPES).trim() || DEFAULT_SCOPES;
}

interface RequestLike {
  url: string;
  headers: {
    get(name: string): string | null;
  };
}

export function getPublicOrigin(request?: RequestLike): string {
  const configuredBaseUrl: string =
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "";

  if (configuredBaseUrl) {
    return trimTrailingSlashes(configuredBaseUrl);
  }

  const forwardedProto: string = request?.headers?.get?.("x-forwarded-proto") || "";
  const forwardedHost: string = request?.headers?.get?.("x-forwarded-host") || "";
  const host: string = forwardedHost || request?.headers?.get?.("host") || "";
  if (host) {
    const protocol: string = (forwardedProto || new URL(request!.url).protocol || "http:").replace(/:$/, "");
    return `${protocol}://${host}`.replace(/\/+$/, "");
  }

  return trimTrailingSlashes(new URL(request!.url).origin);
}

interface OidcSettings {
  oidcIssuerUrl?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcScopes?: string;
  oidcLoginLabel?: string;
  authMode?: string;
  [key: string]: unknown;
}

export function isOidcConfigured(settings: OidcSettings): boolean {
  return !!(
    trimTrailingSlashes(settings?.oidcIssuerUrl) &&
    (settings?.oidcClientId || "").trim() &&
    (settings?.oidcClientSecret || "").trim()
  );
}

interface OidcRuntimeConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  loginLabel: string;
}

export async function getOidcRuntimeConfig(): Promise<OidcRuntimeConfig | null> {
  const settings: OidcSettings = await getSettings() as OidcSettings;
  if (!["oidc", "both"].includes(settings.authMode || "") || !isOidcConfigured(settings)) return null;

  const issuerUrl: string = trimTrailingSlashes(settings.oidcIssuerUrl);
  return {
    issuerUrl,
    clientId: settings.oidcClientId!.trim(),
    clientSecret: settings.oidcClientSecret!.trim(),
    scopes: normalizeScopes(settings.oidcScopes),
    loginLabel: (settings.oidcLoginLabel || DEFAULT_LOGIN_LABEL).trim() || DEFAULT_LOGIN_LABEL,
  };
}

interface OidcDiscoveryDocument {
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  [key: string]: unknown;
}

export async function fetchOidcDiscovery(issuerUrl: string): Promise<OidcDiscoveryDocument> {
  const discoveryUrl: string = `${trimTrailingSlashes(issuerUrl)}/.well-known/openid-configuration`;
  const res: Response = await fetch(discoveryUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load OIDC discovery document from ${discoveryUrl}`);
  }
  return await res.json();
}

interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier: string = crypto.randomBytes(32).toString("base64url");
  const challenge: string = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOidcState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function createOidcNonce(): string {
  return crypto.randomBytes(16).toString("base64url");
}

interface OidcAuthorizationUrlParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes?: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export function buildOidcAuthorizationUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  scopes = DEFAULT_SCOPES,
  state,
  nonce,
  codeChallenge,
}: OidcAuthorizationUrlParams): string {
  const url: URL = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", normalizeScopes(scopes));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface OidcCodeExchangeParams {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export async function exchangeOidcCode({
  tokenEndpoint,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}: OidcCodeExchangeParams): Promise<Record<string, unknown>> {
  const body: URLSearchParams = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const res: Response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message: string = (data?.error_description as string) || (data?.error as string) || `OIDC token exchange failed (${res.status})`;
    throw new Error(message);
  }

  return data;
}

interface ProbeOidcClientSecretParams {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

interface ProbeResult {
  tested: boolean;
  valid: boolean | null;
  message: string;
  raw?: Record<string, unknown>;
}

export async function probeOidcClientSecret({
  tokenEndpoint,
  clientId,
  clientSecret,
  redirectUri,
}: ProbeOidcClientSecretParams): Promise<ProbeResult> {
  if (!clientSecret) {
    return {
      tested: false,
      valid: null,
      message: "No client secret was provided, so secret validation was skipped.",
    };
  }

  const body: URLSearchParams = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code: "__oidc_test_invalid_code__",
    redirect_uri: redirectUri,
    code_verifier: "__oidc_test_invalid_verifier__",
  });

  const res: Response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data: Record<string, unknown> = await res.json().catch(() => ({}));
  const error: string = ((data?.error as string) || "").toLowerCase();
  const errorDescription: string = (data?.error_description as string) || (data?.error as string) || "";

  if (res.ok) {
    return {
      tested: true,
      valid: true,
      message: "Client secret was accepted by the token endpoint.",
      raw: data,
    };
  }

  if (error === "invalid_client" || error === "unauthorized_client" || /client.*(invalid|failed|mismatch)/i.test(errorDescription)) {
    return {
      tested: true,
      valid: false,
      message: errorDescription || "Client secret is not valid.",
      raw: data,
    };
  }

  if (error === "invalid_grant" || error === "invalid_code" || /grant|code/i.test(errorDescription)) {
    return {
      tested: true,
      valid: true,
      message: "Client secret was accepted; the token exchange failed only because the test authorization code is invalid.",
      raw: data,
    };
  }

  return {
    tested: true,
    valid: null,
    message: errorDescription || `Token endpoint responded with ${res.status}`,
    raw: data,
  };
}

interface VerifyOidcIdTokenParams {
  idToken: string;
  issuer: string;
  audience: string;
  jwksUri: string;
  nonce?: string;
}

export async function verifyOidcIdToken({
  idToken,
  issuer,
  audience,
  jwksUri,
  nonce,
}: VerifyOidcIdTokenParams): Promise<JWTPayload> {
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience,
    nonce,
  });
  return payload;
}

export function pickOidcDisplayName(payload: Record<string, unknown> = {}): string {
  return (payload.preferred_username as string) || (payload.email as string) || (payload.name as string) || (payload.given_name as string) || (payload.sub as string) || "OIDC user";
}

export function pickOidcEmail(payload: Record<string, unknown> = {}): string {
  return (payload.email as string) || "";
}
