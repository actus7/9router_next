import { NextResponse } from "next/server";
import { disableTailscale } from "@/lib/tunnel";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { configureTunnelMonitoring } from "@/shared/services/initializeApp";

export async function POST() {
  try {
    const result = await disableTailscale();
    getSettings()
      .then(configureTunnelMonitoring)
      .catch((error) => console.warn("Tailscale monitor update failed:", error.message));
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Tailscale disable error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
