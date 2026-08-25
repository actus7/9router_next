"use client";

import { useState, useEffect, useCallback } from "react";
import { getCapabilitiesForModel } from "@/lib/open-sse/providers/capabilities";

interface ModelCapabilities {
  vision: boolean;
  search: boolean;
  reasoning: boolean;
  contextWindow: number;
  maxOutput: number;
}

interface ModelEntry {
  caps?: ModelCapabilities;
  fullModel?: string;
  routedModel?: string;
  model?: string;
}

interface CapsMaps {
  byFull: Record<string, ModelCapabilities>;
  byId: Record<string, ModelCapabilities>;
}

interface UseModelCapsReturn {
  getCaps: (key: string | null | undefined) => ModelCapabilities | null;
}

// Module cache: one /api/models fetch shared by every useModelCaps instance.
let cache: CapsMaps | null = null;
let inflight: Promise<CapsMaps> | null = null;

function buildMaps(models: ModelEntry[]): CapsMaps {
  const byFull: Record<string, ModelCapabilities> = {};
  const byId: Record<string, ModelCapabilities> = {};
  for (const m of models || []) {
    if (!m.caps) continue;
    if (m.fullModel) byFull[m.fullModel] = m.caps;
    if (m.routedModel) byFull[m.routedModel] = m.caps;
    if (m.model) byId[m.model] = m.caps;
  }
  return { byFull, byId };
}

function loadModelCaps(): Promise<CapsMaps> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/models")
    .then(async (res) => {
      if (!res.ok) throw new Error(`models ${res.status}`);
      const data = await res.json();
      cache = buildMaps(data.models);
      return cache!;
    })
    .catch(() => {
      // Keep null so a later mount can retry
      return { byFull: {}, byId: {} } as CapsMaps;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// Resolve caps from a "provider/model" string or a bare model id.
function resolveCaps(
  byFull: Record<string, ModelCapabilities>,
  byId: Record<string, ModelCapabilities>,
  key: string | null | undefined,
): ModelCapabilities | null {
  if (!key) return null;
  if (byFull[key]) return byFull[key];
  const bare: string = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
  if (byId[bare]) return byId[bare];
  const provider: string | null = key.includes("/") ? key.slice(0, key.indexOf("/")) : null;
  const c = getCapabilitiesForModel(provider ?? "", bare) as Record<string, unknown>;
  return {
    vision: !!c.vision,
    search: !!c.search,
    reasoning: !!c.reasoning,
    contextWindow: (c.contextWindow as number) || 0,
    maxOutput: (c.maxOutput as number) || 0,
  };
}

export function useModelCaps(): UseModelCapsReturn {
  const [byFull, setByFull] = useState<Record<string, ModelCapabilities>>(
    () => cache?.byFull || {},
  );
  const [byId, setById] = useState<Record<string, ModelCapabilities>>(
    () => cache?.byId || {},
  );

  useEffect(() => {
    if (cache) {
      setByFull(cache.byFull);
      setById(cache.byId);
      return;
    }
    let alive = true;
    loadModelCaps().then((maps) => {
      if (alive) { setByFull(maps.byFull); setById(maps.byId); }
    });
    return () => { alive = false; };
  }, []);

  const getCaps = useCallback(
    (key: string | null | undefined): ModelCapabilities | null => resolveCaps(byFull, byId, key),
    [byFull, byId],
  );

  return { getCaps };
}
