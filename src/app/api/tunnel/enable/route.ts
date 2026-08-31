import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { configureTunnelMonitoring } from "@/shared/services/initializeApp";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  try {
    const result = await enableTunnel();
    getSettings()
      .then(configureTunnelMonitoring)
      .catch((error) => console.warn("Tunnel monitor start failed:", error.message));
    // Wait for DNS warmup to propagate at Cloudflare edge after tunnel registered
    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
