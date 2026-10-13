"use client";

import { useState, useEffect, useMemo } from "react";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers";
import { usePickerCatalog } from "./pickerCatalog";

export interface ActiveProvider {
  provider: string; id?: string; name?: string; isActive?: boolean; providerSpecificData?: Record<string, unknown>;
}

export function useModelDataFetcher(isOpen: boolean, activeProviders: ActiveProvider[]) {
  const [combos, setCombos] = useState<{ id: string; name: string }[]>([]);
  const [cursorModels, setCursorModels] = useState<{ id: string; name: string }[]>([]);
  const { providerNodes, customModels, disabledModels } = usePickerCatalog(isOpen);

  const cursorConnectionIds = useMemo(
    () => activeProviders.filter((p) => p.provider === "cursor" && p.id).map((p) => p.id as string),
    [activeProviders],
  );

  useEffect(() => {
    if (!isOpen || cursorConnectionIds.length === 0) { setCursorModels([]); return; }
    let cancelled = false;
    Promise.all(cursorConnectionIds.map(async (id) => {
      const r = await fetch(`/api/providers/${id}/models`, { cache: "no-store" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d.models) ? d.models : [];
    })).then((lists) => {
      if (cancelled) return;
      const seen = new Set<string>();
      setCursorModels(lists.flat().filter((m: { id?: string }) => { if (!m?.id || seen.has(m.id)) return false; seen.add(m.id); return true; }));
    }).catch(() => { if (!cancelled) setCursorModels([]); });
    return () => { cancelled = true; };
  }, [isOpen, cursorConnectionIds]);

  useEffect(() => { if (isOpen) fetch("/api/combos").then((r) => r.json()).then((d) => setCombos(d.combos || [])).catch(() => setCombos([])); }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  return { combos, providerNodes, customModels, disabledModels, cursorModels, allProviders };
}
