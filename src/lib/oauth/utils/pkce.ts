import crypto from "crypto";

/**
 * Generate PKCE code verifier (43-128 characters)
 *
 * @param bytes number of random bytes (xAI uses 96)
 */
export function generateCodeVerifier(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Generate PKCE code challenge from verifier (S256 method)
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate random state for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/**
 * Generate complete PKCE pair
 */
export function generatePKCE(bytes: number = 32): PKCEPair {
  const codeVerifier: string = generateCodeVerifier(bytes);
  const codeChallenge: string = generateCodeChallenge(codeVerifier);
  const state: string = generateState();

  return {
    codeVerifier,
    codeChallenge,
    state,
  };
}
