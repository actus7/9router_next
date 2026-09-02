/**
 * Parse pasted user content (cURL commands, headers, JSON, raw tokens)
 * into a normalised Web Session credential and its origin metadata.
 *
 * Priority order:
 *   1. Cookie from cURL (-H 'Cookie: …', --header "Cookie: …",
 *      -b '…', --cookie '…')
 *   2. Authorization: Bearer … from cURL or raw header text
 *   3. Cookie: … header (standalone)
 *   4. Valid JSON object → minified JSON string
 *   5. Raw value fallback (trimmed, outer quotes stripped)
 *
 * The function is pure: no side-effects, no logging, no network calls.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CredentialOrigin =
  | "curl-cookie"
  | "curl-authorization"
  | "header-authorization"
  | "header-cookie"
  | "json"
  | "raw";

export interface ParsedWebSessionCredential {
  /** The credential value to store (cookie string, bearer token, JSON, etc.). */
  credential: string;
  /** Where the credential was detected. */
  origin: CredentialOrigin;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise line continuations from Chrome "Copy as cURL":
 *   - backslash at end of line  → join lines
 *   - Windows caret at end of line → join lines
 * Then trim each resulting logical line.
 */
function joinContinuationLines(raw: string): string {
  return raw
    .replace(/\\\r?\n/g, " ")   // backslash + newline
    .replace(/\^\r?\n/g, " ")   // caret + newline (Windows cmd)
    .replace(/\r?\n/g, "\n");   // normalise remaining newlines
}

/**
 * Extract all header values from a cURL command string.
 * Handles:
 *   -H 'Name: Value'   --header "Name: Value"
 *   -b 'cookie'         --cookie 'cookie'
 *   -H "Name: Value"    (double quotes)
 *
 * Returns an array of { name, value } where name is lower-cased.
 */
function extractCurlHeaders(cmd: string): Array<{ name: string; value: string }> {
  const results: Array<{ name: string; value: string }> = [];

  // -H / --header patterns (single or double quotes)
  const headerRe = /(?:-H|--header)\s+(['"])(.*?)\1/gs;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(cmd)) !== null) {
    const raw = m[2].trim();
    const colonIdx = raw.indexOf(":");
    if (colonIdx > 0) {
      results.push({
        name: raw.slice(0, colonIdx).trim().toLowerCase(),
        value: raw.slice(colonIdx + 1).trim(),
      });
    }
  }

  // -b / --cookie patterns → treated as a Cookie header
  const cookieRe = /(?:-b|--cookie)\s+(['"])(.*?)\1/gs;
  while ((m = cookieRe.exec(cmd)) !== null) {
    results.push({ name: "cookie", value: m[2].trim() });
  }

  return results;
}

/**
 * Try to parse a string as JSON. Returns the minified string when it is a
 * valid JSON object (not array, not primitive), or null otherwise.
 */
function tryJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return JSON.stringify(parsed); // minified
    }
  } catch {
    // not valid JSON
  }
  return null;
}

/**
 * Strip outer matching quotes and trim whitespace.
 */
function stripOuterQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * Check whether a trimmed string looks like a cURL command.
 */
function looksLikeCurl(raw: string): boolean {
  return /^curl\s/i.test(raw);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse pasted content and return a normalised credential + origin.
 *
 * Returns `null` when the input is empty or whitespace-only.
 */
export function parseWebSessionCredential(
  input: string,
): ParsedWebSessionCredential | null {
  if (typeof input !== "string") return null;
  const raw = joinContinuationLines(input);
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ── 1. cURL command ──────────────────────────────────────────────────────
  if (looksLikeCurl(trimmed)) {
    const headers = extractCurlHeaders(trimmed);

    // 1a. Cookie takes priority
    const cookie = headers.find((h) => h.name === "cookie");
    if (cookie && cookie.value) {
      return { credential: cookie.value, origin: "curl-cookie" };
    }

    // 1b. Authorization: Bearer …
    const auth = headers.find(
      (h) => h.name === "authorization" && /^bearer\s+/i.test(h.value),
    );
    if (auth && auth.value) {
      // Return only the token part after "Bearer "
      const token = auth.value.replace(/^bearer\s+/i, "").trim();
      if (token) {
        return { credential: token, origin: "curl-authorization" };
      }
    }
  }

  // ── 2. Standalone Authorization header ────────────────────────────────────
  const authHeaderRe = /^authorization:\s*bearer\s+(.+)$/im;
  const authMatch = authHeaderRe.exec(trimmed);
  if (authMatch) {
    const token = authMatch[1].trim();
    if (token) {
      return { credential: token, origin: "header-authorization" };
    }
  }

  // ── 3. Standalone Cookie header ──────────────────────────────────────────
  const cookieHeaderRe = /^cookie:\s*(.+)$/im;
  const cookieMatch = cookieHeaderRe.exec(trimmed);
  if (cookieMatch) {
    const value = cookieMatch[1].trim();
    if (value) {
      return { credential: value, origin: "header-cookie" };
    }
  }

  // ── 4. JSON object ───────────────────────────────────────────────────────
  const json = tryJsonObject(trimmed);
  if (json !== null) {
    return { credential: json, origin: "json" };
  }

  // ── 5. Raw fallback ──────────────────────────────────────────────────────
  const cleaned = stripOuterQuotes(trimmed);
  if (cleaned) {
    return { credential: cleaned, origin: "raw" };
  }

  return null;
}
