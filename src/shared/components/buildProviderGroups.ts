"use client";

import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, getProviderAlias } from "@/shared/constants/providers";

type RawModel = { id: string; name: string; [key: string]: unknown };
interface PickerModel { id: string; name: string; value: string; }
export interface PickerGroup { name: string; color: string; models: PickerModel[]; }

function buildPassthroughGroup(alias: string, providerId: string, providerInfo: Record<string, unknown>, modelAliases: Record<string, string>, customModels: { id: string; name?: string; providerAlias?: string }[], providerNodes: { id: string; name?: string }[]): PickerGroup | null {
  const aliasModels = Object.entries(modelAliases).filter(([, v]) => v.startsWith(`${alias}/`)).map(([n, v]) => ({ id: v.replace(`${alias}/`, ""), name: n, value: v }));
  const customRegistered = customModels.filter((m) => m.providerAlias === alias).map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}` }));
  const registeredLlms = customRegistered.filter((m) => !getModelKind(m as unknown as Record<string, unknown>) || getModelKind(m as unknown as Record<string, unknown>) === "llm");
  const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
  const hardcoded = (getModelsByProviderId(providerId) as RawModel[]).filter((m) => !getModelKind(m) || getModelKind(m) === "llm").map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}` })).filter((m) => !seen.has(m.value));
  const models = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((r) => r.value === m.value)), ...hardcoded];
  if (models.length === 0) return null;
  const matchedNode = providerNodes.find((n) => n.id === providerId);
  return { name: matchedNode?.name || (providerInfo.name as string), color: providerInfo.color as string, models };
}

function buildCustomGroup(providerId: string, providerInfo: Record<string, unknown>, modelAliases: Record<string, string>, customModels: { id: string; name?: string; providerAlias?: string }[], activeProviders: { provider: string; id?: string; name?: string; providerSpecificData?: Record<string, unknown> }[], providerNodes: { id: string; name?: string; prefix?: string }[]): PickerGroup | null {
  const connection = activeProviders.find((p) => p.provider === providerId);
  const matchedNode = providerNodes.find((n) => n.id === providerId);
  const displayName = matchedNode?.name || connection?.name || (providerInfo.name as string);
  const nodePrefix = (connection?.providerSpecificData?.prefix as string) || matchedNode?.prefix || providerId;
  const nodeModels = Object.entries(modelAliases).filter(([, v]) => v.startsWith(`${providerId}/`)).map(([n, v]) => ({ id: v.replace(`${providerId}/`, ""), name: n, value: `${nodePrefix}/${v.replace(`${providerId}/`, "")}` }));
  const registeredCustom = customModels.filter((m) => m.providerAlias === providerId).map((m) => ({ id: m.id, name: m.name || m.id, value: `${nodePrefix}/${m.id}` }));
  const seen = new Set(nodeModels.map((m) => m.value));
  const models = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];
  if (models.length === 0) return null;
  return { name: displayName, color: providerInfo.color as string, models };
}

function buildStandardGroup(alias: string, providerId: string, providerInfo: Record<string, unknown>, modelAliases: Record<string, string>, customModels: { id: string; name?: string; providerAlias?: string }[]): PickerGroup | null {
  const hardcodedModels = getModelsByProviderId(providerId) as RawModel[];
  const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));
  const hasHardcoded = hardcodedModels.length > 0;
  const customAliasModels = Object.entries(modelAliases).filter(([n, v]) => v.startsWith(`${alias}/`) && (hasHardcoded ? n === v.replace(`${alias}/`, "") : true) && !hardcodedIds.has(v.replace(`${alias}/`, ""))).map(([n, v]) => ({ id: v.replace(`${alias}/`, ""), name: n, value: v }));
  const customAliasIds = new Set(customAliasModels.map((m) => m.id));
  const customRegistered = customModels.filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id)).map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}` }));
  const merged: PickerModel[] = [...hardcodedModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm").map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}` })), ...customAliasModels, ...customRegistered];
  const seen = new Set<string>();
  const models = merged.filter((m) => { if (seen.has(m.value)) return false; seen.add(m.value); return true; });
  if (models.length === 0) return null;
  return { name: providerInfo.name as string, color: providerInfo.color as string, models };
}

export function buildProviderGroups(params: {
  sortedProviderIds: string[]; allProviders: Record<string, Record<string, unknown>>;
  activeProviders: { provider: string; id?: string; name?: string; providerSpecificData?: Record<string, unknown> }[];
  modelAliases: Record<string, string>; providerNodes: { id: string; name?: string; prefix?: string }[];
  customModels: { id: string; name?: string; providerAlias?: string }[];
}): Record<string, PickerGroup> {
  const { sortedProviderIds, allProviders, activeProviders, modelAliases, providerNodes, customModels } = params;
  const result: Record<string, PickerGroup> = {};
  sortedProviderIds.forEach((providerId) => {
    const alias = getProviderAlias(providerId);
    const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
    const isCustom = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    let group: PickerGroup | null = null;
    if (providerInfo.passthroughModels) group = buildPassthroughGroup(alias, providerId, providerInfo, modelAliases, customModels, providerNodes);
    else if (isCustom) group = buildCustomGroup(providerId, providerInfo, modelAliases, customModels, activeProviders, providerNodes);
    else group = buildStandardGroup(alias, providerId, providerInfo, modelAliases, customModels);
    if (group) result[providerId] = group;
  });
  return result;
}
