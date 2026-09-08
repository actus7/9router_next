import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { configureTunnelMonitoring, setTunnelOwner } from "@/shared/services/initializeApp";
import { currentTenantId } from "@/lib/db/tenant";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  try {
    // One cloudflared per machine, but `tunnelEnabled` is a row per account —
    // so the process remembers who turned it on, and the watchdog restarts it
    // under that account rather than guessing.
    setTunnelOwner(currentTenantId());
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
// Application HTTP use case extracted from the Next.js route adapter.
