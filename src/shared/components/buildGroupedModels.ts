"use client";

import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, getProviderAlias } from "@/shared/constants/providers";

type RawModel = { id: string; name: string; [key: string]: unknown };

export interface ModelItem {
  id: string;
  name: string;
  value: string;
  isPlaceholder?: boolean;
  isCustom?: boolean;
  kind?: string;
}

export interface ModelGroup {
  name: string;
  alias: string;
  color: string;
  models: ModelItem[];
  isCustom?: boolean;
  hasModels?: boolean;
}

const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);
const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);

function providerSupportsKind(providerInfo: Record<string, unknown> | undefined, kind: string): boolean {
  return ((providerInfo?.serviceKinds as string[] | undefined) || ["llm"]).includes(kind);
}

function filterByKind(models: ModelItem[], kindFilter: string | null): ModelItem[] {
  if (!kindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m as unknown as Record<string, unknown>) || getModelKind(m as unknown as Record<string, unknown>) === "llm");
  if (!TYPED_KINDS.has(kindFilter)) return models;
  return models.filter((m) => m.isPlaceholder || getModelKind(m as unknown as Record<string, unknown>) === kindFilter);
}

function buildPassthroughModels(
  providerId: string, alias: string, providerInfo: Record<string, unknown>,
  modelAliases: Record<string, string>, customModels: { id: string; name?: string; providerAlias?: string }[],
  kindFilter: string | null, providerNodes: { id: string; name?: string }[],
): ModelGroup | null {
  const aliasModels = Object.entries(modelAliases)
    .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
    .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${alias}/`, ""), name: aliasName, value: fullModel }));
  const customRegisteredModels = customModels
    .filter((m) => m.providerAlias === alias)
    .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, kind: getModelKind(m) ?? undefined, isCustom: true }));

  let combined: ModelItem[];
  if (kindFilter && TYPED_KINDS.has(kindFilter)) {
    const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === kindFilter);
    combined = [
      ...registeredTyped,
      ...(getModelsByProviderId(providerId) as RawModel[])
        .filter((m: RawModel) => getModelKind(m) === kindFilter)
        .map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) ?? undefined }))
        .filter((m: { value: string }) => !registeredTyped.some((r) => r.value === m.value)),
    ];
    if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
      const supports = ((providerInfo.serviceKinds as string[]) || ["llm"]).includes(kindFilter);
      if (supports) combined = [{ id: providerId, name: providerInfo.name as string, value: alias }];
    }
  } else {
    const registeredLlms = customRegisteredModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm");
    const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
    const hardcoded = (getModelsByProviderId(providerId) as RawModel[])
      .filter((m: RawModel) => !getModelKind(m) || getModelKind(m) === "llm")
      .map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) ?? undefined }))
      .filter((m: { value: string }) => !seen.has(m.value));
    combined = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((r) => r.value === m.value)), ...hardcoded];
  }
  if (combined.length === 0) return null;
  const matchedNode = providerNodes.find((node) => node.id === providerId);
  return { name: matchedNode?.name || (providerInfo.name as string), alias, color: providerInfo.color as string, models: combined };
}

function buildCustomProviderModels(
  providerId: string, providerInfo: Record<string, unknown>,
  modelAliases: Record<string, string>, customModels: { id: string; name?: string; providerAlias?: string }[],
  activeProviders: { provider: string; id?: string; name?: string; providerSpecificData?: Record<string, unknown> }[],
  providerNodes: { id: string; name?: string; prefix?: string }[],
): ModelGroup | null {
  const connection = activeProviders.find((p) => p.provider === providerId);
  const matchedNode = providerNodes.find((node) => node.id === providerId);
  const displayName = matchedNode?.name || connection?.name || (providerInfo.name as string);
  const nodePrefix = (connection?.providerSpecificData?.prefix as string) || matchedNode?.prefix || providerId;
  const nodeModels = Object.entries(modelAliases)
    .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
    .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${providerId}/`, ""), name: aliasName, value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}` }));
  const registeredCustom = customModels
    .filter((m) => m.providerAlias === providerId)
    .map((m) => ({ id: m.id, name: m.name || m.id, value: `${nodePrefix}/${m.id}`, isCustom: true }));
  const seen = new Set(nodeModels.map((m) => m.value));
  const mergedModels = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];
  const modelsToShow = mergedModels.length > 0 ? mergedModels : [{
    id: `__placeholder__${providerId}`, name: `${nodePrefix}/model-id`, value: `${nodePrefix}/model-id`, isPlaceholder: true,
  }];
  return { name: displayName, alias: nodePrefix, color: providerInfo.color as string, models: modelsToShow, isCustom: true, hasModels: mergedModels.length > 0 };
}

function buildStandardProviderModels(
  providerId: string, alias: string, providerInfo: Record<string, unknown>,
  modelAliases: Record<string, string>, customModels: { id: string; name?: string; providerAlias?: string }[],
  kindFilter: string | null, cursorModels: { id: string; name: string }[],
): ModelGroup | null {
  const hardcodedModels: RawModel[] = providerId === "cursor" && cursorModels.length > 0
    ? cursorModels : (getModelsByProviderId(providerId) as RawModel[]);
  const hardcodedIds = new Set(hardcodedModels.map((m: RawModel) => m.id));
  const hasHardcoded = hardcodedModels.length > 0;
  const customAliasModels = Object.entries(modelAliases)
    .filter(([aliasName, fullModel]) => fullModel.startsWith(`${alias}/`) && (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) && !hardcodedIds.has(fullModel.replace(`${alias}/`, "")))
    .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${alias}/`, ""), name: aliasName, value: fullModel, isCustom: true }));
  const customAliasIds = new Set(customAliasModels.map((m) => m.id));
  const customRegisteredModels = customModels
    .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
    .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, isCustom: true }));
  const merged: ModelItem[] = [
    ...hardcodedModels.map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) ?? undefined })),
    ...customAliasModels, ...customRegisteredModels,
  ];
  const seen = new Set<string>();
  let allModels = filterByKind(merged.filter((m) => { if (seen.has(m.value)) return false; seen.add(m.value); return true; }), kindFilter);
  if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
    const supports = ((providerInfo.serviceKinds as string[]) || ["llm"]).includes(kindFilter);
    if (supports) allModels = [{ id: providerId, name: providerInfo.name as string, value: alias }];
  }
  if (allModels.length === 0) return null;
  return { name: providerInfo.name as string, alias, color: providerInfo.color as string, models: allModels };
}

/**
 * The connections a picker may offer models from: every one but those switched
 * off. Pages hand the pickers all of the account's connections — the prop is
 * named `activeProviders` but nothing upstream filters it — so this is the one
 * place both pickers agree on what "active" means. Undefined counts as active,
 * the same reading the router uses (`isActive !== false`).
 */
export function usableConnections<T extends { isActive?: boolean }>(connections: readonly T[]): T[] {
  return connections.filter((connection) => connection.isActive !== false);
}

export function buildGroupedModels(params: {
  filteredActiveProviders: { provider: string; id?: string; name?: string; isActive?: boolean; providerSpecificData?: Record<string, unknown> }[];
  activeProviders: { provider: string; id?: string; name?: string; isActive?: boolean; providerSpecificData?: Record<string, unknown> }[];
  modelAliases: Record<string, string>;
  allProviders: Record<string, Record<string, unknown>>;
  providerNodes: { id: string; name?: string; prefix?: string }[];
  customModels: { id: string; name?: string; providerAlias?: string }[];
  disabledModels: Record<string, string[]>;
  kindFilter: string | null;
  cursorModels: { id: string; name: string }[];
  PROVIDER_ORDER: string[];
  NO_AUTH_PROVIDER_IDS: string[];
}): Record<string, ModelGroup> {
  const { modelAliases, allProviders, providerNodes, customModels, disabledModels, kindFilter, cursorModels, PROVIDER_ORDER, NO_AUTH_PROVIDER_IDS } = params;
  const filteredActiveProviders = usableConnections(params.filteredActiveProviders);
  const activeProviders = usableConnections(params.activeProviders);
  const groups: Record<string, ModelGroup> = {};
  const activeConnectionIds = filteredActiveProviders.map((p) => p.provider);
  const noAuthIds = kindFilter
    ? NO_AUTH_PROVIDER_IDS.filter((id) => { const info = AI_PROVIDERS[id as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined; return ((info?.serviceKinds as string[]) || ["llm"]).includes(kindFilter); })
    : NO_AUTH_PROVIDER_IDS;
  // No kind filter means a chat picker. Search-only providers list models with no
  // `kind`, so the per-model filter alone would let them through as LLMs — and a
  // chat sent to one comes back as a list of links instead of an answer.
  const providerIdsToShow = new Set(
    [...activeConnectionIds, ...noAuthIds].filter((id) =>
      kindFilter ? true : providerSupportsKind(allProviders[id] || AI_PROVIDERS[id as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined, "llm")),
  );
  // Uma varredura para resolver a posição de todos, em vez de um `indexOf` sobre
  // os ~194 providers do registry por comparação do sort.
  const providerRank = new Map(PROVIDER_ORDER.map((id, index) => [id, index]));
  const sortedProviderIds = [...providerIdsToShow].sort(
    (a, b) => (providerRank.get(a) ?? 999) - (providerRank.get(b) ?? 999),
  );

  sortedProviderIds.forEach((providerId) => {
    const alias = getProviderAlias(providerId);
    const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
    const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

    if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
      groups[providerId] = { name: providerInfo.name as string, alias, color: providerInfo.color as string, models: [{ id: providerId, name: providerInfo.name as string, value: providerId }] };
      return;
    }
    if (providerInfo.passthroughModels) {
      const group = buildPassthroughModels(providerId, alias, providerInfo, modelAliases, customModels, kindFilter, providerNodes);
      if (group) groups[providerId] = group;
    } else if (isCustomProvider) {
      if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
      const group = buildCustomProviderModels(providerId, providerInfo, modelAliases, customModels, activeProviders, providerNodes);
      if (group) groups[providerId] = group;
    } else {
      const group = buildStandardProviderModels(providerId, alias, providerInfo, modelAliases, customModels, kindFilter, cursorModels);
      if (group) groups[providerId] = group;
    }
  });

  return dropDisabledModels(groups, disabledModels);
}

/**
 * Removes the models switched off on each provider's page ("Modelos
 * desativados"), and providers left with none. Rows are stored under the
 * provider alias or its id, so both are read. Shared by both pickers: the combo
 * tier picker once skipped it and offered every Kiro model the operator had
 * turned off.
 */
export function dropDisabledModels<G extends { models: Array<{ id: string }> }>(
  groups: Record<string, G>,
  disabledModels: Record<string, string[]>,
): Record<string, G> {
  const result: Record<string, G> = {};
  for (const [providerId, group] of Object.entries(groups)) {
    const disabledIds = new Set([...(disabledModels[getProviderAlias(providerId)] || []), ...(disabledModels[providerId] || [])]);
    const models = disabledIds.size === 0 ? group.models : group.models.filter((m) => !disabledIds.has(m.id));
    if (models.length > 0) result[providerId] = models === group.models ? group : { ...group, models };
  }
  return result;
}
