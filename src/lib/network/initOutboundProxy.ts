import { getSettings } from "@/lib/db/repos/settingsRepo";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { withTenant } from "@/lib/db/tenant";
import { listTenantIds } from "@/lib/db/tenants";

let initialized: boolean = false;

/**
 * Applies the stored outbound proxy to this process, on a single-account
 * instance only.
 *
 * `applyOutboundProxyEnv` writes `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` into
 * `process.env`, which is one setting for the whole machine — but
 * `outboundProxyEnabled` is now a row per account. On a self-hosted install
 * with one account those are the same thing and nothing changes. With several,
 * whichever account happened to be read first would route everybody else's
 * upstream traffic through its proxy, so it stays unset and says so; set
 * `HTTPS_PROXY` in the environment instead, which is where a deployment-wide
 * proxy belongs.
 *
 * This runs from `instrumentation.ts` at boot, where there is no request and
 * therefore no tenant — reading `settings` unscoped is what raised
 * `TenantContextError` on the first start after the migration.
 */
export async function ensureOutboundProxyInitialized(): Promise<boolean> {
  if (initialized) return true;

  try {
    const tenants: string[] = await listTenantIds();
    if (tenants.length !== 1) {
      if (tenants.length > 1) {
        console.log(
          `[ServerInit] ${tenants.length} accounts: skipping the stored outbound proxy ` +
          `(one process-wide setting, no single owner). Use HTTPS_PROXY to set one for the deployment.`,
        );
      }
      initialized = true;
      return initialized;
    }

    await withTenant(tenants[0]!, async () => {
      const settings: Record<string, unknown> = await getSettings() as Record<string, unknown>;
      applyOutboundProxyEnv(settings as { outboundProxyEnabled?: boolean; outboundProxyUrl?: string; outboundNoProxy?: string });
    });
    initialized = true;
  } catch (error: unknown) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}
