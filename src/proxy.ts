import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth/server";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { proxy as dashboardProxy } from "./dashboardGuard";
import { buildContentSecurityPolicy, CSP_REPORT_ONLY_HEADER, REPORTING_ENDPOINTS } from "./lib/security/contentSecurityPolicy";

const neonAuth = auth.middleware({ loginUrl: SIGN_IN_PATH });

/**
 * Hosts allowed to serve the dashboard, comma-separated. Empty means any.
 *
 * Replaces the old `tunnelDashboardAccess` setting. That was a row in
 * `settings`, which is now one row per account — and the middleware has to
 * decide whether to serve the sign-in page *before* it knows which account is
 * asking, so it can no longer read it. Exposing the dashboard over a tunnel is
 * a property of the deployment, not of a user's preferences, so it moved to
 * the environment where the deployment is configured.
 */
const allowedHosts: Set<string> = new Set(
  (process.env.DASHBOARD_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

function isAllowedDashboardHost(request: NextRequest): boolean {
  if (allowedHosts.size === 0) return true;
  const host: string = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  return allowedHosts.has(host);
}

/**
 * A program never wants a login page.
 *
 * Dashboard `/api/*` requests do go through the auth middleware — that is what
 * refreshes the `session_data` cookie, see `dashboardGuard` — but the
 * middleware's answer to a session it cannot verify is a redirect to sign-in.
 * `fetch` follows that and hands the caller HTML with `res.ok === true`, so a
 * failed save would read as a successful one. Any cookies the middleware set on
 * the way (including clearing a stale one) are kept.
 */
export function asApiResponse(response: NextResponse): NextResponse {
  if (response.status < 300 || response.status >= 400) return response;
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Gateway paths answer for themselves — an API key or a CLI token, never a
  // redirect to a login page, because their callers are programs.
  const handled: NextResponse | null = await dashboardProxy(request);
  if (handled) return handled;

  if (request.nextUrl.pathname.startsWith("/dashboard") && !isAllowedDashboardHost(request)) {
    return NextResponse.json({ error: "Dashboard is not served on this host" }, { status: 404 });
  }

  // Set on the *request* because that is where Next looks for the nonce to
  // stamp onto its own bootstrap scripts (`app-render.js` reads
  // `content-security-policy` or `content-security-policy-report-only` off the
  // incoming headers). Without it every framework script reports a violation
  // and buries the ones that mean something. `neonAuth` forwards the request
  // headers it was given, so setting them here is enough.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const policy = buildContentSecurityPolicy(nonce);
  request.headers.set(CSP_REPORT_ONLY_HEADER, policy);
  request.headers.set("x-nonce", nonce);

  const authenticated: NextResponse = await neonAuth(request);
  const response: NextResponse = request.nextUrl.pathname.startsWith("/api/")
    ? asApiResponse(authenticated)
    : authenticated;
  // Report-only on purpose: this policy has never run against the real page.
  // The unknown is what `js.puter.com` pulls in once its SDK boots, and a
  // guess that is wrong in enforce mode breaks chat for everyone. Read the
  // violations first, then narrow and switch the header name.
  response.headers.set("Content-Security-Policy-Report-Only", policy);
  response.headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
