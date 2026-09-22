import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS, getModelKind } from "@/shared/constants/models";
import {
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { fetchCompatibleModelIds } from "./compatibleModelFetch";
import { LIVE_MODEL_RESOLVERS, type ConnectionRecord } from "./liveModelResolvers";
import {
  LLM_KIND,
  comboMatchesKinds,
  modelKind,
  providerMatchesKinds,
  type ProviderContext,
} from "./modelsListTypes";

/** Build combo model entries filtered by kind. */
export function buildComboEntries(
  combos: Record<string, unknown>[],
  kindFilter: string[],
): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry: Record<string, unknown> = {
      id: combo.name,
      object: "model",
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch" || combo.kind === "smart") {
      entry.kind = combo.kind;
    }
    entries.push(entry);
  }
  return entries;
}

/** Resolve raw model IDs and live/static metadata for a single provider. */
export async function resolveProviderContext(
  conn: ConnectionRecord,
  providerId: string,
  kindFilter: string[],
  skipDynamicFetch: boolean,
): Promise<ProviderContext | null> {
  if (!providerMatchesKinds(providerId, kindFilter)) return null;

  const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const outputAlias = ((
    conn?.providerSpecificData?.prefix
    || getProviderAlias(providerId)
    || staticAlias
  ) as string).trim();
  const providerModels = PROVIDER_MODELS[staticAlias] || [];
  const enabledModels = conn?.providerSpecificData?.enabledModels;
  const hasExplicitEnabledModels =
    Array.isArray(enabledModels) && enabledModels.length > 0;
  const isCompatibleProvider =
    isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

  // Build kind lookup for static models so we can filter even when only IDs are exposed
  const staticModelKindById = new Map<string, string>(
    providerModels.map((m) => [m.id as string, modelKind(m)])
  );
  let liveModelKindById = new Map<string, string>();
  let liveCapabilitiesById = new Map<string, Record<string, unknown>>();

  let rawModelIds = hasExplicitEnabledModels
    ? Array.from(
        new Set(
          enabledModels.filter(
            (modelId) => typeof modelId === "string" && modelId.trim() !== "",
          ),
        ),
      )
    : providerModels.map((model) => model.id);

  if (isCompatibleProvider && rawModelIds.length === 0 && !skipDynamicFetch) {
    rawModelIds = await fetchCompatibleModelIds(conn);
  }

  // Config-driven live catalog override (e.g. Kiro returns dynamic
  // -thinking/-agentic variants per account). On failure, fall back to
  // whatever rawModelIds already holds.
  const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
  if (liveResolver && !hasExplicitEnabledModels) {
    try {
      const live = await liveResolver(conn);
      if (live?.models?.length) {
        rawModelIds = live.models.map((m) => m.id);
        liveModelKindById = new Map<string, string>(
          live.models
            .filter((m) => m?.id)
            .map((m) => [m.id as string, modelKind(m)])
        );
        liveCapabilitiesById = new Map<string, Record<string, unknown>>(
          live.models
            .filter((m) => m?.id && m.capabilities)
            .map((m) => [m.id as string, m.capabilities as Record<string, unknown>])
        );
      }
    } catch (error) { console.error(`Live model fetch failed for ${providerId}: ${(error instanceof Error ? error.message : String(error))}`); }
  }

  return { providerId, outputAlias, staticAlias, rawModelIds, staticModelKindById, liveModelKindById, liveCapabilitiesById };
}

/** Strip provider prefixes and merge static, custom, and alias model IDs. */
export function collectMergedModelIds(
  ctx: ProviderContext,
  customModels: Record<string, unknown>[],
  modelAliases: Record<string, unknown>,
  kindFilter: string[],
): { mergedModelIds: string[]; customModelKindById: Map<string, string> } {
  const { outputAlias, staticAlias, providerId, rawModelIds } = ctx;

  const modelIds = rawModelIds
    .map((modelId) => {
      if (modelId.startsWith(`${outputAlias}/`)) {
        return modelId.slice(outputAlias.length + 1);
      }
      if (modelId.startsWith(`${staticAlias}/`)) {
        return modelId.slice(staticAlias.length + 1);
      }
      if (modelId.startsWith(`${providerId}/`)) {
        return modelId.slice(providerId.length + 1);
      }
      return modelId;
    })
    .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

  // The kind of every stored model of this provider, not only of those this
  // list includes: the same id also arrives from the live listing, and without
  // its stored kind it fell through to the name heuristic — which is how the
  // Vercel image models showed up in the chat list after discovery typed them.
  const customModelKindById = new Map<string, string>();
  const ownModels = customModels.filter((m: Record<string, unknown>) => {
    if (!m?.id) return false;
    const alias = m.providerAlias;
    return alias === staticAlias || alias === outputAlias || alias === providerId;
  });
  for (const m of ownModels) {
    const modelId = String(m.id).trim();
    if (modelId) customModelKindById.set(modelId, getModelKind(m) || LLM_KIND);
  }
  const customModelIds = ownModels
    .filter((m: Record<string, unknown>) => {
      const kind = getModelKind(m) || LLM_KIND;
      // imageToText custom models are vision-capable chat models: expose them
      // both in the default LLM list and in /v1/models/image-to-text.
      return kindFilter.includes(kind) || (kind === "imageToText" && kindFilter.includes(LLM_KIND));
    })
    .map((m) => String(m.id).trim())
    .filter((modelId) => modelId !== "");

  const aliasModelIds = (Object.values(modelAliases || {}) as string[])
    .filter((fullModel: string) => {
      if (typeof fullModel !== "string" || !fullModel.includes("/")) return false;
      return (
        fullModel.startsWith(`${outputAlias}/`) ||
        fullModel.startsWith(`${staticAlias}/`) ||
        fullModel.startsWith(`${providerId}/`)
      );
    })
    .map((fullModel: string) => {
      if (fullModel.startsWith(`${outputAlias}/`)) {
        return fullModel.slice(outputAlias.length + 1);
      }
      if (fullModel.startsWith(`${staticAlias}/`)) {
        return fullModel.slice(staticAlias.length + 1);
      }
      if (fullModel.startsWith(`${providerId}/`)) {
        return fullModel.slice(providerId.length + 1);
      }
      return fullModel;
    })
    .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

  const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));
  return { mergedModelIds, customModelKindById };
}
