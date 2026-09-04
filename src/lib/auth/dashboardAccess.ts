import { cookies, headers } from "next/headers";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { isLocalRequest } from "@/dashboardGuard";

/**
 * Whether the caller may act as the dashboard owner.
 *
 * `src/proxy.ts` already gates every `/api/*` path; this is the second layer for
 * handlers that act with the owner's authority (running sandboxed code, editing
 * agent memory, toggling plugins). It deliberately reuses `isLocalRequest` so
 * the two layers cannot drift apart: turning login off is a local single-user
 * mode, so it must not hand authority to a remote caller. Settings that cannot
 * be read fall back to requiring a verified session.
 */
export async function hasDashboardAccess(): Promise<boolean> {
  const token = (await cookies()).get("auth_token")?.value;
  if (token && (await verifyDashboardAuthToken(token))) return true;

  let loginDisabled = false;
  try {
    loginDisabled = (await getSettings()).requireLogin === false;
  } catch {
    /* unreadable settings must not open the dashboard up */
  }
  if (!loginDisabled) return false;

  return isLocalRequest(new Request("http://local", { headers: await headers() }));
}
