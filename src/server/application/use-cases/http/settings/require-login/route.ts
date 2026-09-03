import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";

export async function GET(): Promise<NextResponse> {
  // Reading settings is invisible to Next's dynamic tracking, so without this the
  // route prerenders and serves the build-time login configuration forever.
  await assertRequestRuntime();
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin !== false;
    const tunnelDashboardAccess = settings.tunnelDashboardAccess !== false;
    const tunnelUrl = settings.tunnelUrl || "";
    const tailscaleUrl = settings.tailscaleUrl || "";
    return NextResponse.json({ requireLogin, tunnelDashboardAccess, tunnelUrl, tailscaleUrl });
  } catch  {
    return NextResponse.json({ requireLogin: true }, { status: 200 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
