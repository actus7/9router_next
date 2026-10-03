import { auth } from "@/lib/auth/server";
import { extendResponseSetCookies, hasRememberMeFlag } from "@/lib/auth/persistentCookies";

// Neon Auth owns every /api/auth/* path now. The old siblings under this
// directory — login, logout, status, reset-password, oidc/*, saml/* — were the
// single-operator password flow and the SSO modes, and are gone.
const authHandler = auth.handler();

/**
 * Persistent sign-in ("remember me").
 *
 * When the request carries the `remember_me=1` flag cookie the parallel UI
 * writes through `document.cookie` (`AuthView` has no checkbox for it), the
 * cookies this handler sets get a 30-day `Max-Age`/`Expires` instead of dying
 * with the browser session.
 *
 * Rewriting *every* `Set-Cookie` from the auth handler is acceptable because
 * only Neon Auth's own cookies are minted on `/api/auth/*` — session_token,
 * session_data and their sign-out counterparts. Nothing else reaches these
 * headers. Sign-out is safe by construction: `extendAuthCookies` never touches
 * a deletion cookie (Max-Age=0, a past Expires or an empty value), so logging
 * out cannot be turned into "keep the session for 30 days".
 */
async function withPersistentCookies(
  request: Request,
  context: RouteContext<"/api/auth/[...path]">,
  respond: typeof authHandler.GET,
): Promise<Response> {
  const response = await respond(request, context);
  extendResponseSetCookies(response.headers, hasRememberMeFlag(request.headers.get("cookie")));
  return response;
}

export async function GET(request: Request, context: RouteContext<"/api/auth/[...path]">): Promise<Response> {
  return withPersistentCookies(request, context, authHandler.GET);
}

export async function POST(request: Request, context: RouteContext<"/api/auth/[...path]">): Promise<Response> {
  return withPersistentCookies(request, context, authHandler.POST);
}
