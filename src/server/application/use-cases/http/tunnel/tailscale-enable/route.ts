import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { configureTunnelMonitoring, setTailscaleOwner } from "@/shared/services/initializeApp";
import { currentTenantId } from "@/lib/db/tenant";

export async function POST() {
  try {
    // See the tunnel enable route: one daemon per machine, one setting row per
    // account, so the process records who turned it on.
    setTailscaleOwner(currentTenantId());
    const result = await enableTailscale();
    getSettings()
      .then(configureTunnelMonitoring)
      .catch((error) => console.warn("Tailscale monitor start failed:", error.message));
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Tailscale enable error:", (error as Error).message);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
