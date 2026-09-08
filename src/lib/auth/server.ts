import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

export { SIGN_IN_PATH, SIGN_UP_PATH, ACCOUNT_PATH } from "./paths";

/**
 * The one Neon Auth instance for the server.
 *
 * It is also the only source of identity in the app. There is no operator
 * password and no OIDC/SAML any more: this deployment has accounts, and the
 * account id is what every row in the database is filed under (see
 * `src/lib/db/tenant.ts`). A second way to become "logged in" would be a second
 * way to become a tenant, which is why the old single-password mode had to go
 * rather than sit alongside this.
 *
 * `baseUrl` is the full auth endpoint from the Neon console — project host plus
 * `/<database>/auth` — because the SDK appends paths to it directly.
 */
function requireEnv(name: string): string {
  const value: string | undefined = process.env[name];
  if (!value) {
    throw new Error(
      `[auth] ${name} is not set. Copy it from the Neon console (Auth → Configuration); ` +
      `the app cannot identify anyone without it, and every database row is owned by an account.`,
    );
  }
  return value;
}

export const auth = createNeonAuth({
  baseUrl: requireEnv("NEON_AUTH_BASE_URL"),
  cookies: {
    // Signs the session-data cookie, which is what lets `getSession()` answer
    // from the cookie itself instead of a round trip on every request.
    secret: requireEnv("NEON_AUTH_COOKIE_SECRET"),
  },
});
