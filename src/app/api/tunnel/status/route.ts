import { NextResponse } from "next/server";
import { getTunnelStatus, getTailscaleStatus, getDownloadStatus } from "@/lib/tunnel";

const STATUS_CACHE_TTL_MS = 3000; // coalesce rapid polls; underlying probes already cache 10s

// Survive hot reload; one cache per process. Only tunnel/tailscale probes are cached —
// download progress stays live so the enable/download UI updates smoothly.
const statusCache = ((global as Record<string, unknown>).__tunnelStatusCache ??= { value: null, fetchedAt: 0 }) as { value: unknown; fetchedAt: number };

export async function GET() {
  try {
    let probes = statusCache.value as Record<string, unknown> | null;
    if (!probes || Date.now() - statusCache.fetchedAt >= STATUS_CACHE_TTL_MS) {
      const [tunnel, tailscale] = await Promise.all([getTunnelStatus(), getTailscaleStatus()]);
      probes = { tunnel, tailscale };
      statusCache.value = probes;
      statusCache.fetchedAt = Date.now();
    }
    const download = getDownloadStatus();
    return NextResponse.json({ ...(probes as Record<string, unknown>), download });
  } catch (error: unknown) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
