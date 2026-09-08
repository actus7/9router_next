import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth/server";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { proxy as dashboardProxy } from "./dashboardGuard";

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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // API and gateway paths answer for themselves — an API key or a CLI token,
  // never a redirect to a login page, because their callers are programs.
  const handled: NextResponse | null = await dashboardProxy(request);
  if (handled) return handled;

  if (request.nextUrl.pathname.startsWith("/dashboard") && !isAllowedDashboardHost(request)) {
    return NextResponse.json({ error: "Dashboard is not served on this host" }, { status: 404 });
  }

  return neonAuth(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
