import type { ConnectionRecord } from "./liveModelResolvers";
import {
  buildComboEntries,
  buildStaticModelEntries,
  collectMergedModelIds,
  resolveProviderContext,
} from "./modelsListBuilders";
import { fetchModelsData } from "./modelsListData";
import { buildNoAuthWebEntries, buildProviderModelEntries, deduplicateModels } from "./modelsListProviderEntries";

/**
 * Build OpenAI-format models list filtered by service kinds.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 */
export async function buildModelsList(kindFilter: string[], options: { skipDynamicFetch?: boolean } = {}) {
  // When this header is present, the /v1/models request came from another
  // modelhub instance's fetchCompatibleModelIds — skip dynamic fetch to break
  // cross-instance recursive loops.
  const skipDynamicFetch = options.skipDynamicFetch === true;
  const data = await fetchModelsData();
  const isDisabled = (alias: string, modelId: string) =>
    Array.isArray(data.disabledByAlias[alias]) && data.disabledByAlias[alias].includes(modelId);

  const activeConnectionByProvider = new Map<string, ConnectionRecord>();
  for (const conn of data.connections) {
    if (conn.provider && !activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models: Record<string, unknown>[] = [];

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  models.push(...buildComboEntries(data.combos, kindFilter));

  if (data.connections.length === 0) {
    // DB unavailable -> return static models, filtered by per-model kind
    models.push(...buildStaticModelEntries(kindFilter, isDisabled, data.customModels));
  } else {
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      const ctx = await resolveProviderContext(conn, providerId, kindFilter, skipDynamicFetch);
      if (!ctx) continue;
      const { mergedModelIds, customModelKindById } = collectMergedModelIds(ctx, data.customModels, data.modelAliases, kindFilter);
      models.push(...buildProviderModelEntries(ctx, mergedModelIds, customModelKindById, kindFilter, isDisabled));
    }
  }

  // Add noAuth web providers that have no active connection (searchViaChat / searchConfig / fetchConfig)
  const connectedProviderIds = new Set(activeConnectionByProvider.keys());
  models.push(...buildNoAuthWebEntries(kindFilter, connectedProviderIds));

  return deduplicateModels(models);
}
