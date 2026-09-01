import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { configureTunnelMonitoring } from "@/shared/services/initializeApp";

export async function POST() {
  try {
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
