"use client";

import { useState, useMemo, useEffect } from "react";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";
import { buildGroupedModels, type ModelItem, type ModelGroup } from "./buildGroupedModels";

const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(id => (FREE_PROVIDERS as Record<string, { noAuth?: boolean }>)[id].noAuth);

export interface ActiveProvider {
  provider: string;
  id?: string;
  name?: string;
  providerSpecificData?: Record<string, unknown>;
}

export type { ModelItem, ModelGroup };

export interface UseModelSelectDataProps {
  isOpen: boolean;
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
  kindFilter: string | null;
  capFilter: string | null;
  addedModelValues: string[];
  searchQuery: string;
}

export function useModelSelectData({
  isOpen,
  activeProviders,
  modelAliases,
  kindFilter,
  capFilter,
  addedModelValues,
  searchQuery,
}: UseModelSelectDataProps) {
  const { getCaps } = useModelCaps();
  const [combos, setCombos] = useState<{ id: string; name: string }[]>([]);
  const [providerNodes, setProviderNodes] = useState<{ id: string; name?: string; prefix?: string }[]>([]);
  const [customModels, setCustomModels] = useState<{ id: string; name?: string; providerAlias?: string }[]>([]);
  const [disabledModels, setDisabledModels] = useState<Record<string, string[]>>({});
  const [cursorModels, setCursorModels] = useState<{ id: string; name: string }[]>([]);

  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p) => {
      const info = AI_PROVIDERS[p.provider as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
      const kinds = (info?.serviceKinds as string[]) || ["llm"];
      return kinds.includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);

  const cursorConnectionIds = useMemo(
    () => activeProviders
      .filter((provider) => provider.provider === "cursor" && provider.id)
      .map((provider) => provider.id as string),
    [activeProviders],
  );

  useEffect(() => {
    if (!isOpen || cursorConnectionIds.length === 0) {
      setCursorModels([]);
      return undefined;
    }

    let cancelled = false;
    Promise.all(cursorConnectionIds.map(async (connectionId) => {
      const response = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    }))
      .then((modelLists) => {
        if (cancelled) return;
        const seen = new Set<string>();
        setCursorModels(modelLists.flat().filter((model: { id?: string }) => {
          if (!model?.id || seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }));
      })
      .catch((error) => {
        console.warn("Unable to load Cursor models for selector:", error);
        if (!cancelled) setCursorModels([]);
      });

    return () => { cancelled = true; };
  }, [isOpen, cursorConnectionIds]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/combos").then((r) => r.json()).then((d) => setCombos(d.combos || [])).catch(() => setCombos([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/provider-nodes").then((r) => r.json()).then((d) => setProviderNodes(d.nodes || [])).catch(() => setProviderNodes([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/models/custom").then((r) => r.json()).then((d) => setCustomModels(d.models || [])).catch(() => setCustomModels([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/models/disabled").then((r) => r.json()).then((d) => setDisabledModels(d.disabled || {})).catch(() => setDisabledModels({}));
  }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  const groupedModels = useMemo(() => buildGroupedModels({
    filteredActiveProviders, activeProviders, modelAliases, allProviders,
    providerNodes, customModels, disabledModels, kindFilter, cursorModels,
    PROVIDER_ORDER, NO_AUTH_PROVIDER_IDS,
  }), [filteredActiveProviders, modelAliases, allProviders, providerNodes, customModels, disabledModels, kindFilter, activeProviders, cursorModels]);

  const filteredCombos = useMemo(() => {
    if (kindFilter || capFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter(c => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter]);

  const sortModels = (models: ModelItem[]) => {
    const added = models.filter(m => addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = models.filter(m => !addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  };

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered: Record<string, ModelGroup> = {};
    Object.entries(groupedModels).forEach(([providerId, group]) => {
      let models = group.models;
      if (capFilter) {
        models = models.filter((m) => (getCaps(m.value) as Record<string, boolean> | null)?.[capFilter] === true);
        if (models.length === 0) return;
      }
      if (query) {
        const providerNameMatches = group.name.toLowerCase().includes(query);
        models = models.filter(
          (m) =>
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query)
        );
        if (models.length === 0 && !providerNameMatches) return;
      }
      filtered[providerId] = {
        ...group,
        models: sortModels(models),
      };
    });

    return filtered;
  }, [groupedModels, searchQuery, addedModelValues]);

  return { filteredGroups, filteredCombos, getCaps };
}
