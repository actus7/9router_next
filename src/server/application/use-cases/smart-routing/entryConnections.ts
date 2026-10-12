import "server-only";

import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { resolveProviderId } from "@/shared/constants/providers";
import type { SmartRoutingConfig } from "@/shared/llm-catalog";

/**
 * An error message when a lane entry fixes an account that is not this
 * account's connection to the entry's provider; null when every one is. The
 * repo is tenant-scoped, so another account's connection id is simply absent.
 * Checked on save so the user hears about it now: at request time such an
 * entry would fail every attempt.
 */
export async function findForeignEntryConnection(config: SmartRoutingConfig | null | undefined): Promise<string | null> {
  const wanted: Array<{ where: string; provider: string; id: string }> = [];
  for (const [need, tiers] of Object.entries(config?.entries ?? {})) {
    for (const [tier, lane] of Object.entries(tiers ?? {})) {
      const models = config?.overrides[need as keyof SmartRoutingConfig["overrides"]]?.[tier as "simple"] ?? [];
      (lane ?? []).forEach((entry, index) => {
        const modelKey = models[index];
        if (!entry?.connectionId || !modelKey) return;
        wanted.push({ where: `routing.entries.${need}.${tier}[${index}] (${modelKey})`, provider: resolveProviderId(modelKey.slice(0, modelKey.indexOf("/"))), id: entry.connectionId });
      });
    }
  }
  if (wanted.length === 0) return null;
  const owned = await getProviderConnections({});
  const bad = wanted.find((item) => !owned.some((connection) => connection.id === item.id && resolveProviderId(String(connection.provider)) === item.provider));
  return bad ? `${bad.where}: connectionId is not one of your ${bad.provider} connections` : null;
}
