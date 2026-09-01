"use client";

import { useMemo } from "react";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { AI_PROVIDERS, FREE_PROVIDERS, OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers";
import { buildGroupedModels, type ModelItem, type ModelGroup } from "./buildGroupedModels";
import { useModelDataFetcher, type ActiveProvider } from "./useModelDataFetcher";
import { filterAndSortGroups } from "./filterAndSortGroups";

const PROVIDER_ORDER = [...Object.keys(OAUTH_PROVIDERS), ...Object.keys(FREE_PROVIDERS), ...Object.keys(FREE_TIER_PROVIDERS), ...Object.keys(APIKEY_PROVIDERS)];
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => (FREE_PROVIDERS as Record<string, { noAuth?: boolean }>)[id].noAuth);

export type { ActiveProvider, ModelItem, ModelGroup };

export interface UseModelSelectDataProps {
  isOpen: boolean; activeProviders: ActiveProvider[]; modelAliases: Record<string, string>;
  kindFilter: string | null; capFilter: string | null; addedModelValues: string[]; searchQuery: string;
}

export function useModelSelectData({ isOpen, activeProviders, modelAliases, kindFilter, capFilter, addedModelValues, searchQuery }: UseModelSelectDataProps) {
  const { getCaps } = useModelCaps();
  const { combos, providerNodes, customModels, disabledModels, cursorModels, allProviders } = useModelDataFetcher(isOpen, activeProviders);

  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p) => {
      const info = AI_PROVIDERS[p.provider as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
      return ((info?.serviceKinds as string[]) || ["llm"]).includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);

  const groupedModels = useMemo(() => buildGroupedModels({
    filteredActiveProviders, activeProviders, modelAliases, allProviders,
    providerNodes, customModels, disabledModels, kindFilter, cursorModels,
    PROVIDER_ORDER, NO_AUTH_PROVIDER_IDS,
  }), [filteredActiveProviders, modelAliases, allProviders, providerNodes, customModels, disabledModels, kindFilter, activeProviders, cursorModels]);

  const filteredCombos = useMemo(() => {
    if (kindFilter || capFilter) return [];
    if (!searchQuery.trim()) return combos;
    const q = searchQuery.toLowerCase();
    return combos.filter((c) => c.name.toLowerCase().includes(q));
  }, [combos, searchQuery, kindFilter]);

  const filteredGroups = useMemo(() => filterAndSortGroups({ groupedModels, searchQuery, capFilter, addedModelValues, getCaps }), [groupedModels, searchQuery, addedModelValues]);

  return { filteredGroups, filteredCombos, getCaps };
}
