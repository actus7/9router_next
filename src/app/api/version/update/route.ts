import { NextResponse } from "next/server";
import { tenantRoute } from "@/server/application/http/tenantRoute";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";

/**
 * Self-update for the locally installed CLI build: it kills sibling processes
 * and exits this one.
 *
 * Two gates, because one was not enough. `tenantRoute` is what actually
 * validates the session — the proxy's `ALWAYS_PROTECTED` check only asks
 * whether a cookie *named* `__Secure-neon-auth*` is present, which any client
 * can send, so this handler used to be a one-curl anonymous kill switch.
 * `LOCAL_ONLY_PATHS` in `dashboardGuard.ts` is the second gate: a signed-in
 * account on a shared deployment still has no business stopping the process
 * for every other account.
 */
async function handlePOST(): Promise<NextResponse> {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (modelhub CLI)" },
      { status: 403 }
    );
  }

  try {
    // Kill sibling processes (cloudflared, stray next-server) to release file locks on Windows
    await killAppProcesses();
  } catch { /* best effort */ }

  // Schedule detached updater then exit current server process
  spawnUpdaterAndExit();

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}

export const POST = tenantRoute(handlePOST);
