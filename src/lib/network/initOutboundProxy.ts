import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

let initialized: boolean = false;

async function ensureOutboundProxyInitialized(): Promise<boolean> {
  if (initialized) return true;

  try {
    const settings: Record<string, unknown> = await getSettings() as Record<string, unknown>;
    applyOutboundProxyEnv(settings as { outboundProxyEnabled?: boolean; outboundProxyUrl?: string; outboundNoProxy?: string });
    initialized = true;
  } catch (error: unknown) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}

// Defer init so HTTP server accepts connections first
setImmediate(() => {
  ensureOutboundProxyInitialized().catch(console.log);
});


