"use client";

import { useEffect, useState } from "react";
import type { Applicability } from "./paramApplicability";

export interface ParamDef {
  path: string;
  label?: string;
  description?: string;
  type: string;
  group?: string;
  default?: unknown;
  values?: readonly (string | number | boolean)[];
  range?: { min?: number; max?: number; step?: number };
  applicability?: Applicability;
}
export interface ModelParamInfo {
  spec: { id: string; params: ParamDef[] } | null;
  connections: Array<{ id: string; label: string }>;
}

// One request per model key per page load: every row of every lane asks.
const cache = new Map<string, Promise<ModelParamInfo | null>>();

function load(modelKey: string): Promise<ModelParamInfo | null> {
  let pending = cache.get(modelKey);
  if (!pending) {
    pending = fetch(`/api/smart-routing/model-params?model=${encodeURIComponent(modelKey)}`)
      .then((res) => (res.ok ? (res.json() as Promise<ModelParamInfo>) : null))
      .catch(() => null);
    cache.set(modelKey, pending);
  }
  return pending;
}

/** The parameters and accounts behind a lane entry; null while loading or when unknown. */
export function useModelParamInfo(modelKey: string): ModelParamInfo | null {
  const [info, setInfo] = useState<ModelParamInfo | null>(null);
  useEffect(() => {
    let live = true;
    setInfo(null);
    void load(modelKey).then((value) => { if (live) setInfo(value); });
    return () => { live = false; };
  }, [modelKey]);
  return info;
}
