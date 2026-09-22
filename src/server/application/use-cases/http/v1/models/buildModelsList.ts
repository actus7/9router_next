import { waitUntil } from "@vercel/functions";

import { getCustomModels } from "@/lib/db/repos/aliasRepo";
import { FREE_PROVIDERS } from "@/shared/constants/providers";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@/server/llm-gateway/catalog";
import { ensureProviderCatalog } from "../../../models/ensureProviderCatalog";
import { getEligibleFreeModelProviders, resolveFreeModelGroups, shippedFreeModels } from "./freeModelGroups";
import type { ConnectionRecord } from "./liveModelResolvers";
import { buildComboEntries, collectMergedModelIds, resolveProviderContext } from "./modelsListBuilders";
import { fetchModelsData } from "./modelsListData";
import { buildNoAuthWebEntries, buildProviderModelEntries, deduplicateModels } from "./modelsListProviderEntries";
import { LLM_KIND } from "./modelsListTypes";
import { FREE_DEFAULT_MODEL, FREE_DEFAULT_PROVIDER_ID } from "@/shared/constants/freeDefault";

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
  // Chamado duas vezes por modelo (alias de saída e alias estático) para cada
  // provider conectado, e a lista de desabilitados cresce sozinha: o "Test All"
  // auto-desabilita todo modelo definitivamente indisponível.
  const disabledSets = new Map<string, Set<string>>(
    Object.entries(data.disabledByAlias)
      .filter(([, ids]) => Array.isArray(ids))
      .map(([alias, ids]) => [alias, new Set(ids)]),
  );
  const isDisabled = (alias: string, modelId: string) => disabledSets.get(alias)?.has(modelId) === true;

  const activeConnectionByProvider = new Map<string, ConnectionRecord>();
  for (const conn of data.connections) {
    if (conn.provider && !activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models: Record<string, unknown>[] = [];
  const providerEntries = async (conn: ConnectionRecord, providerId: string) => {
    const ctx = await resolveProviderContext(conn, providerId, kindFilter, skipDynamicFetch);
    if (!ctx) return [];
    const { mergedModelIds, customModelKindById } = collectMergedModelIds(ctx, data.customModels, data.modelAliases, kindFilter);
    return buildProviderModelEntries(ctx, mergedModelIds, customModelKindById, kindFilter, isDisabled);
  };
  const addProvider = async (conn: ConnectionRecord, providerId: string) => {
    models.push(...(await providerEntries(conn, providerId)));
  };

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  models.push(...buildComboEntries(data.combos, kindFilter));

  // A provider is listed only when a request for it can be served: the account
  // has a connection for it, or it needs none (`getProviderCredentials` answers
  // noAuth providers with public credentials). An account without connections
  // used to get the whole registry here — ~150 providers every request to which
  // failed with "No credentials".
  // A provider that answers a models endpoint ships no static list, so without
  // a discovered catalogue there is nothing to list it with. Wait for the ones
  // we know nothing about — a client's first request should see the provider,
  // not see it appear on the second — and revalidate the rest in the background.
  if (!skipDynamicFetch) {
    const unknown: string[] = [];
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const enabled = conn?.providerSpecificData?.enabledModels;
      const known = (PROVIDER_MODELS[alias]?.length ?? 0) > 0
        || (Array.isArray(enabled) && enabled.length > 0)
        || data.customModels.some((model) => model.providerAlias === alias);
      if (known) waitUntil(ensureProviderCatalog(providerId));
      else unknown.push(providerId);
    }
    if (unknown.length > 0) {
      await Promise.all(unknown.map((providerId) => ensureProviderCatalog(providerId)));
      try {
        data.customModels = (await getCustomModels()) as unknown as Record<string, unknown>[];
      } catch { /* the list below simply stays as it was */ }
    }
  }

  // Um provider não lê nada do outro — `resolveProviderContext` só usa a própria
  // conexão e faz a chamada remota dele. Concatenar na ordem original preserva o
  // dedup "primeiro id vence" de `deduplicateModels`.
  const perProvider = await Promise.all(
    Array.from(activeConnectionByProvider.entries())
      .map(([providerId, conn]) => providerEntries(conn, providerId)),
  );
  for (const entries of perProvider) models.push(...entries);

  if (kindFilter.includes(LLM_KIND)) {
    const keyless = getEligibleFreeModelProviders(FREE_PROVIDERS)
      .filter((provider) => !activeConnectionByProvider.has(String(provider.id)));
    // ponytail: remote discovery on every call, bounded by
    // FREE_MODEL_DISCOVERY_TIMEOUT_MS per provider in parallel. Cache per
    // process if /v1/models latency starts to matter to clients.
    const groups = await resolveFreeModelGroups(keyless, skipDynamicFetch ? shippedFreeModels : undefined);
    for (const group of groups) {
      // The discovered catalogue becomes a pseudo-connection's allow-list, so
      // it runs through the same kind, disabled and capability pipeline as a
      // real connection instead of a second copy of it.
      await addProvider({
        id: "noauth",
        accessToken: "public",
        provider: group.providerId,
        providerSpecificData: { enabledModels: group.models.map((model) => model.id) },
      }, group.providerId);
    }

    // The credential-free default is a free model of a provider that normally
    // takes a key (Kilo). Without a connection nothing above lists it, and the
    // chat's first-run model is looked up in this list.
    if (!activeConnectionByProvider.has(FREE_DEFAULT_PROVIDER_ID)) {
      await addProvider({
        id: "noauth",
        accessToken: "public",
        provider: FREE_DEFAULT_PROVIDER_ID,
        providerSpecificData: { enabledModels: [FREE_DEFAULT_MODEL] },
      }, FREE_DEFAULT_PROVIDER_ID);
    }
  }

  // Add noAuth web providers that have no active connection (searchViaChat / searchConfig / fetchConfig)
  const connectedProviderIds = new Set(activeConnectionByProvider.keys());
  models.push(...buildNoAuthWebEntries(kindFilter, connectedProviderIds));

  return deduplicateModels(models);
}
