import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo";
export async function GET(): Promise<NextResponse> {
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
