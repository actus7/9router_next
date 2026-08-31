"use client";

import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, getProviderAlias } from "@/shared/constants/providers";

type RawModel = { id: string; name: string; [key: string]: unknown };

interface PickerModel {
  id: string;
  name: string;
  value: string;
}

export interface PickerGroup {
  name: string;
  color: string;
  models: PickerModel[];
}

export function buildProviderGroups(params: {
  sortedProviderIds: string[];
  allProviders: Record<string, Record<string, unknown>>;
  activeProviders: { provider: string; id?: string; name?: string; providerSpecificData?: Record<string, unknown> }[];
  modelAliases: Record<string, string>;
  providerNodes: { id: string; name?: string; prefix?: string }[];
  customModels: { id: string; name?: string; providerAlias?: string }[];
}): Record<string, PickerGroup> {
  const { sortedProviderIds, allProviders, activeProviders, modelAliases, providerNodes, customModels } = params;
  const result: Record<string, PickerGroup> = {};

  sortedProviderIds.forEach((providerId) => {
    const alias = getProviderAlias(providerId);
    const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
    const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

    if (providerInfo.passthroughModels) {
      const aliasModels = Object.entries(modelAliases)
        .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
        .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${alias}/`, ""), name: aliasName, value: fullModel }));
      const customRegistered = customModels
        .filter((m) => m.providerAlias === alias)
        .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}` }));
      const registeredLlms = customRegistered.filter((m) => !getModelKind(m as unknown as Record<string, unknown>) || getModelKind(m as unknown as Record<string, unknown>) === "llm");
      const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
      const hardcoded = (getModelsByProviderId(providerId) as RawModel[])
        .filter((m: RawModel) => !getModelKind(m) || getModelKind(m) === "llm")
        .map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}` }))
        .filter((m) => !seen.has(m.value));
      const models = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((r) => r.value === m.value)), ...hardcoded];
      if (models.length > 0) {
        const matchedNode = providerNodes.find((node) => node.id === providerId);
        result[providerId] = { name: matchedNode?.name || (providerInfo.name as string), color: providerInfo.color as string, models };
      }
    } else if (isCustomProvider) {
      const connection = activeProviders.find((p) => p.provider === providerId);
      const matchedNode = providerNodes.find((node) => node.id === providerId);
      const displayName = matchedNode?.name || connection?.name || (providerInfo.name as string);
      const nodePrefix = (connection?.providerSpecificData?.prefix as string) || matchedNode?.prefix || providerId;
      const nodeModels = Object.entries(modelAliases)
        .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
        .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${providerId}/`, ""), name: aliasName, value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}` }));
      const registeredCustom = customModels
        .filter((m) => m.providerAlias === providerId)
        .map((m) => ({ id: m.id, name: m.name || m.id, value: `${nodePrefix}/${m.id}` }));
      const seen = new Set(nodeModels.map((m) => m.value));
      const models = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];
      if (models.length > 0) result[providerId] = { name: displayName, color: providerInfo.color as string, models };
    } else {
      const hardcodedModels = getModelsByProviderId(providerId) as RawModel[];
      const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));
      const hasHardcoded = hardcodedModels.length > 0;
      const customAliasModels = Object.entries(modelAliases)
        .filter(([aliasName, fullModel]) => fullModel.startsWith(`${alias}/`) && (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) && !hardcodedIds.has(fullModel.replace(`${alias}/`, "")))
        .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${alias}/`, ""), name: aliasName, value: fullModel }));
      const customAliasIds = new Set(customAliasModels.map((m) => m.id));
      const customRegistered = customModels
        .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
        .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}` }));
      const merged: PickerModel[] = [
        ...hardcodedModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm").map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}` })),
        ...customAliasModels, ...customRegistered,
      ];
      const seen = new Set<string>();
      const models = merged.filter((m) => { if (seen.has(m.value)) return false; seen.add(m.value); return true; });
      if (models.length > 0) result[providerId] = { name: providerInfo.name as string, color: providerInfo.color as string, models };
    }
  });
  return result;
}
