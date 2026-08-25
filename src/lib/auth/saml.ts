import { SAML } from "@node-saml/node-saml";
import { getSettings } from "../db/repos/settingsRepo";

/**
 * Formats a raw Base64 string or unformatted X.509 certificate into standard PEM format.
 */
export function formatX509Certificate(certStr: string): string {
  if (!certStr || typeof certStr !== "string") return "";
  const clean: string = certStr
    .replace(/-----BEGIN CERTIFICATE-----/gi, "")
    .replace(/-----END CERTIFICATE-----/gi, "")
    .replace(/[^A-Za-z0-9+/=]/g, "");

  if (!clean) return "";

  const lines: string[] = clean.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

interface SamlSettings {
  samlEntryPoint?: string;
  samlCert?: string;
  samlIssuer?: string;
  samlAttributeEmail?: string;
  samlAttributeName?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

/**
 * Checks whether SAML configuration has essential parameters (entryPoint & cert).
 */
export function isSamlConfigured(settings: SamlSettings): boolean {
  return Boolean(settings?.samlEntryPoint && settings?.samlCert);
}

interface SamlRuntimeConfig {
  configured: boolean;
  settings: SamlSettings;
}

/**
 * Fetches settings and returns runtime status + settings.
 */
export async function getSamlRuntimeConfig(): Promise<SamlRuntimeConfig> {
  const settings: SamlSettings = await getSettings() as SamlSettings;
  return {
    configured: isSamlConfigured(settings),
    settings,
  };
}

const DUMMY_FALLBACK_CERT: string =
  "-----BEGIN CERTIFICATE-----\nMIIC...DUMMY...\n-----END CERTIFICATE-----";

function trimTrailingSlashes(str: string | undefined | null): string {
  return (str || "").replace(/\/+$/, "");
}

interface RequestLike {
  url?: string;
  headers?: {
    get(name: string): string | null;
  };
}

/**
 * Resolves the public Base URL / Origin for SAML requests.
 * Respects settings.baseUrl, process.env.BASE_URL, x-forwarded-proto, and x-forwarded-host.
 */
export function getSamlBaseUrl(request?: RequestLike, settings?: SamlSettings): string {
  const configuredBaseUrl: string =
    (settings?.baseUrl || "").trim() ||
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "";

  if (configuredBaseUrl) {
    return trimTrailingSlashes(configuredBaseUrl);
  }

  if (request) {
    const forwardedProto: string = request?.headers?.get?.("x-forwarded-proto") || "";
    const forwardedHost: string = request?.headers?.get?.("x-forwarded-host") || "";
    const host: string = forwardedHost || request?.headers?.get?.("host") || "";
    if (host) {
      const protocol: string = (forwardedProto || new URL(request.url!).protocol || "http:").replace(/:$/, "");
      return `${protocol}://${host}`.replace(/\/+$/, "");
    }
    if (request.url) {
      return trimTrailingSlashes(new URL(request.url).origin);
    }
  }

  return "http://localhost:20128";
}

export function createSamlInstance(settings: SamlSettings, origin: string): SAML {
  const cert: string = formatX509Certificate(settings?.samlCert || "") || DUMMY_FALLBACK_CERT;
  const callbackUrl: string = `${origin}/api/auth/saml/acs`;
  return new SAML({
    entryPoint: settings?.samlEntryPoint || "https://example.com/sso",
    issuer: settings?.samlIssuer || "urn:9router:sp",
    idpCert: cert,
    cert: cert,
    callbackUrl: callbackUrl,
    acceptedClockSkewMs: 60000,
    wantAssertionsSigned: true,
    validateInResponseTo: "never",
    requestIdExpirationMs: 28800000, // 8 hours
  });
}

interface SamlAuthorizeResult {
  authorizeUrl: string;
  requestId: string;
}

/**
 * Builds SAML AuthnRequest redirect URL and returns { authorizeUrl, requestId }.
 */
export async function buildSamlAuthorizeUrl(request: RequestLike, settings: SamlSettings): Promise<SamlAuthorizeResult> {
  const origin: string = getSamlBaseUrl(request, settings);
  const samlInstance: SAML = createSamlInstance(settings, origin);

  const xml: string = await samlInstance.generateAuthorizeRequestAsync(false, false);
  const match: RegExpMatchArray | null = xml.match(/ID="([^"]+)"/);
  const requestId: string = match ? match[1] : "";

  const authorizeUrl: string = await samlInstance._requestToUrlAsync(xml, null, "authorize", {});

  return { authorizeUrl, requestId };
}

/**
 * Validates SAML POST response from IdP ACS callback and returns user profile.
 */
export async function validateSamlResponse(
  request: RequestLike,
  body: Record<string, unknown> | string,
  expectedRequestId: string,
  settings: SamlSettings
): Promise<Record<string, unknown>> {
  if (!settings?.samlCert) {
    throw new Error("IdP X.509 Certificate (samlCert) is missing or not configured");
  }

  const origin: string = getSamlBaseUrl(request, settings);
  const samlInstance: SAML = createSamlInstance(settings, origin);

  const container: Record<string, unknown> = typeof body === "object" && body !== null ? body as Record<string, unknown> : { SAMLResponse: body };
  const rawSamlResponse: string = container.SAMLResponse as string;

  if (!rawSamlResponse) {
    throw new Error("Missing SAMLResponse parameter in assertion POST body");
  }

  // Parse response XML to inspect InResponseTo for replay protection
  if (expectedRequestId) {
    const xml: string = Buffer.from(rawSamlResponse, "base64").toString("utf8");
    const match: RegExpMatchArray | null = xml.match(/InResponseTo=["']([^"']+)["']/i);
    const inResponseTo: string | null = match ? match[1] : null;

    if (!inResponseTo || inResponseTo !== expectedRequestId) {
      throw new Error(`InResponseTo mismatch: expected ${expectedRequestId}, received ${inResponseTo || "none"}`);
    }
  }

  const result: any = await samlInstance.validatePostResponseAsync({ SAMLResponse: rawSamlResponse });
  const profile: Record<string, unknown> = result?.profile || result;

  return profile;
}

/**
 * Generates standard SP XML Metadata.
 */
export function generateSamlMetadata(origin: string, settings: SamlSettings): string {
  const samlInstance: SAML = createSamlInstance(settings, origin);
  return samlInstance.generateServiceProviderMetadata();
}

/**
 * Extracts email claim from SAML profile assertion.
 */
export function pickSamlEmail(profile: Record<string, unknown> = {}, settings: SamlSettings = {}): string {
  if (!profile) return "";

  // 1. Configured custom attribute
  const customAttr: string | undefined = settings.samlAttributeEmail;
  if (customAttr && profile[customAttr]) {
    const val: unknown = profile[customAttr];
    return Array.isArray(val) ? val[0] : String(val);
  }

  // 2. Common email claims
  const emailKeys: string[] = [
    "email",
    "emailAddress",
    "mail",
    "nameID",
    "nameId",
    "upn",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
  ];

  for (const key of emailKeys) {
    if (profile[key]) {
      const val: unknown = profile[key];
      return Array.isArray(val) ? val[0] : String(val);
    }
  }

  // 3. Fallback: check attributes object if present
  if (profile.attributes) {
    const attrs: Record<string, unknown> = profile.attributes as Record<string, unknown>;
    for (const key of emailKeys) {
      if (attrs[key]) {
        const val: unknown = attrs[key];
        return Array.isArray(val) ? val[0] : String(val);
      }
    }
  }

  return "";
}

/**
 * Extracts display name claim from SAML profile assertion.
 */
export function pickSamlDisplayName(profile: Record<string, unknown> = {}, settings: SamlSettings = {}): string {
  if (!profile) return "";

  // 1. Configured custom attribute
  const customAttr: string | undefined = settings.samlAttributeName;
  if (customAttr && profile[customAttr]) {
    const val: unknown = profile[customAttr];
    return Array.isArray(val) ? val[0] : String(val);
  }

  // 2. Common name claims
  const nameKeys: string[] = [
    "displayName",
    "name",
    "cn",
    "commonName",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  ];

  for (const key of nameKeys) {
    if (profile[key]) {
      const val: unknown = profile[key];
      return Array.isArray(val) ? val[0] : String(val);
    }
  }

  // 3. Combined givenName + surname
  if (profile.givenName || profile.sn || profile.surname) {
    const given: string = (profile.givenName as string) || "";
    const surname: string = (profile.sn as string) || (profile.surname as string) || "";
    const combined: string = `${given} ${surname}`.trim();
    if (combined) return combined;
  }

  // 4. Fallback to email
  return pickSamlEmail(profile, settings);
}
