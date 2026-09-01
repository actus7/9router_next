"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import {
  OAUTH_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
} from "@/shared/constants/providers";
import { filterModelGroups } from "./filterModelGroups";

interface NormalizedModel {
  id: string;
  requestModel: string;
  name: string;
  providerId: string;
  providerName: string;
  source: string;
  caps?: Record<string, boolean>;
  kind?: string;
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerType: string;
  connections: Array<Record<string, unknown>>;
  models: NormalizedModel[];
}

export type AuthTab = "subscription" | "apikey" | "local";

const OAUTH_PROVIDER_IDS = new Set(Object.keys(OAUTH_PROVIDERS));
const FREE_PROVIDER_IDS = new Set([...Object.keys(FREE_PROVIDERS), ...Object.keys(FREE_TIER_PROVIDERS)]);

function classifyProvider(providerId: string): AuthTab {
  if (FREE_PROVIDER_IDS.has(providerId)) return "local";
  if (OAUTH_PROVIDER_IDS.has(providerId)) return "subscription";
  return "apikey";
}

export const TAB_DEFS: { key: AuthTab; label: string; icon: React.ReactNode }[] = [
  { key: "subscription", label: "Subscription", icon: null },
  { key: "apikey", label: "Usage-based", icon: null },
  { key: "local", label: "Local / Free", icon: null },
];

export function useModelPickerFilters({
  open,
  providerGroups,
}: {
  open: boolean;
  providerGroups: ProviderGroup[];
}) {
  const { getCaps } = useModelCaps();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<AuthTab>("apikey");
  const [capFilter, setCapFilter] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const tabCounts = useMemo(() => {
    const counts: Record<AuthTab, number> = { subscription: 0, apikey: 0, local: 0 };
    for (const group of providerGroups) {
      const tab = classifyProvider(group.providerId);
      counts[tab] += group.models.length;
    }
    return counts;
  }, [providerGroups]);

  const hasMultipleTabs = useMemo(() => {
    return Object.values(tabCounts).filter((c) => c > 0).length > 1;
  }, [tabCounts]);

  useEffect(() => {
    if (!open) return;
    if (tabCounts[activeTab] > 0) return;
    const first = TAB_DEFS.find((t) => tabCounts[t.key] > 0);
    if (first) setActiveTab(first.key);
  }, [open, tabCounts, activeTab]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      setSearch("");
      setCapFilter(new Set());
    }
  }, [open]);

  const availableCaps = useMemo(() => {
    const found = new Set<string>();
    for (const group of providerGroups) {
      for (const model of group.models) {
        const caps = getCaps(model.requestModel) || model.caps;
        if (caps) {
          for (const [k, v] of Object.entries(caps)) {
            if (v) found.add(k);
          }
        }
      }
    }
    return Array.from(found);
  }, [providerGroups, getCaps]);

  const filteredGroups = useMemo(() => filterModelGroups({
    providerGroups, search, activeTab, capFilter, hasMultipleTabs, classifyProvider,
    getCaps: getCaps as (key: string) => Record<string, boolean> | null,
  }), [providerGroups, search, activeTab, capFilter, getCaps, hasMultipleTabs]);

  const totalModels = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.models.length, 0),
    [filteredGroups]
  );

  const toggleCap = useCallback((cap: string) => {
    setCapFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }, []);

  return {
    search, setSearch,
    activeTab, setActiveTab,
    capFilter, toggleCap,
    searchRef,
    tabCounts,
    hasMultipleTabs,
    availableCaps,
    filteredGroups,
    totalModels,
    getCaps,
  };
}
