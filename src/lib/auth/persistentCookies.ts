/**
 * Persistent sign-in ("remember me") for the Neon Auth cookies.
 *
 * The sign-in UI is `AuthView` from `@neondatabase/auth` and has no "remember
 * me" checkbox, so the flag is a plain browser cookie the parallel UI writes
 * through `document.cookie`: `remember_me=1` (Path=/, Max-Age=30 days, not
 * HttpOnly because client script writes it). This module is what turns that
 * flag into persistent auth cookies on the server: with the flag present every
 * auth `Set-Cookie` gets `Max-Age`/`Expires`, so the browser keeps it across
 * restarts instead of dropping it when the session ends. Without the flag
 * nothing changes — the cookies stay session-scoped exactly as the SDK wrote
 * them.
 *
 * Fail-open throughout: a header that cannot be parsed is returned untouched,
 * and nothing here is allowed to fail a response.
 */

/** The flag cookie the UI sets through `document.cookie`. */
export const REMEMBER_ME_COOKIE_NAME = "remember_me";

/** 30 days — the lifetime the flag cookie itself asks for. */
export const DEFAULT_MAX_AGE_SECONDS = 2592000;

/**
 * Whether the request carries the `remember_me=1` flag.
 *
 * A plain `Cookie`-header scan for the `remember_me=1` token. Nothing to
 * verify: the flag only says "keep the session cookies around", never "trust
 * this request".
 */
export function hasRememberMeFlag(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return false;
    return (
      pair.slice(0, eq).trim() === REMEMBER_ME_COOKIE_NAME &&
      pair.slice(eq + 1).trim() === "1"
    );
  });
}

/**
 * Whether a `Set-Cookie` header is asking the browser to *drop* a cookie.
 *
 * A deletion must never be extended: giving one a `Max-Age` turns "forget this
 * session" into "keep it for 30 days", and sign-out would log nobody out.
 * Three spellings mean deletion: an empty value after `=`, a `Max-Age` of zero
 * or less (any casing), and an `Expires` already at or before now.
 */
function isDeletionCookie(header: string, now: Date): boolean {
  const [pair = "", ...attributes] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq !== -1 && pair.slice(eq + 1).trim() === "") return true;
  for (const attribute of attributes) {
    const sep = attribute.indexOf("=");
    const name = (sep === -1 ? attribute : attribute.slice(0, sep)).trim().toLowerCase();
    const value = sep === -1 ? "" : attribute.slice(sep + 1).trim();
    if (name === "max-age") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds <= 0) return true;
    } else if (name === "expires") {
      const at = Date.parse(value);
      if (!Number.isNaN(at) && at <= now.getTime()) return true;
    }
  }
  return false;
}

/**
 * Rewrites one `Set-Cookie` header with a persistent lifetime.
 *
 * `Max-Age` and `Expires` are replaced in place when present — never
 * duplicated — and appended when absent. Every other attribute (Path, Domain,
 * HttpOnly, Secure, SameSite, Partitioned) keeps its original bytes, casing
 * and order; segments are split on ";" and anything that is not `Max-Age`/
 * `Expires` is copied verbatim.
 */
function extendOneSetCookie(header: string, maxAgeSeconds: number, now: Date): string {
  if (isDeletionCookie(header, now)) return header;
  const expires = new Date(now.getTime() + maxAgeSeconds * 1000).toUTCString();
  const [pair = "", ...attributes] = header.split(";");
  const out: string[] = [pair];
  let sawMaxAge = false;
  let sawExpires = false;
  for (const attribute of attributes) {
    const sep = attribute.indexOf("=");
    const rawName = sep === -1 ? attribute : attribute.slice(0, sep);
    const name = rawName.trim().toLowerCase();
    if (name === "max-age") {
      if (!sawMaxAge) {
        sawMaxAge = true;
        out.push(`${rawName}=${maxAgeSeconds}`);
      }
      continue;
    }
    if (name === "expires") {
      if (!sawExpires) {
        sawExpires = true;
        out.push(`${rawName}=${expires}`);
      }
      continue;
    }
    out.push(attribute);
  }
  if (!sawMaxAge) out.push(` Max-Age=${maxAgeSeconds}`);
  if (!sawExpires) out.push(` Expires=${expires}`);
  return out.join(";");
}

/**
 * Gives every auth cookie header a persistent lifetime when `rememberMe`.
 *
 * Runs over *all* the `Set-Cookie` headers an auth response carries, which is
 * safe because only Neon Auth's own cookies are minted through it. Deletion
 * cookies (sign-out) pass through untouched — that rule is what keeps the
 * flag from re-animating a session the user just ended. With `rememberMe`
 * false the headers come back byte-identical.
 */
export function extendAuthCookies(
  setCookieHeaders: string[],
  rememberMe: boolean,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): string[] {
  if (!rememberMe) return setCookieHeaders;
  const now = new Date();
  return setCookieHeaders.map((header) => extendOneSetCookie(header, maxAgeSeconds, now));
}

/**
 * Applies `extendAuthCookies` to the `Set-Cookie` headers of a response.
 *
 * Rewrites in place, so the body and every other header stay untouched, and
 * always through `getSetCookie()` + `append` — never `set` — so each cookie
 * keeps its own header line. Without the flag nothing is touched at all. The
 * in-place form is what the middleware needs: a `NextResponse` carries
 * middleware state that rebuilding it as a plain `Response` would drop.
 */
export function extendResponseSetCookies(
  headers: Headers,
  rememberMe: boolean,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): void {
  if (!rememberMe) return;
  const existing = headers.getSetCookie();
  if (existing.length === 0) return;
  const extended = extendAuthCookies(existing, true, maxAgeSeconds);
  headers.delete("Set-Cookie");
  for (const cookie of extended) headers.append("Set-Cookie", cookie);
}
