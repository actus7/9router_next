"use client";

import { getThinkingLevels } from "@/shared/llm-catalog";
import type { CustomModelEntry, LiveModel } from "../types";

export function computeProviderThinkingLevels(
  providerId: string,
  providerStorageAlias: string,
  models: LiveModel[],
  kiloFreeModels: LiveModel[],
  customModels: CustomModelEntry[],
): string[] | null {
  const set = new Set<string>();
  const seen = new Set<string>();
  const addLevels = (modelId: string) => {
    if (!modelId || seen.has(modelId)) return;
    seen.add(modelId);
    const lv = getThinkingLevels(providerId, modelId);
    if (lv) lv.forEach((l: string) => { if (l !== "none") set.add(l); });
  };
  for (const m of models) addLevels(m.id);
  for (const m of kiloFreeModels) addLevels(m.id);
  for (const entry of customModels) {
    if (entry.providerAlias !== providerStorageAlias) continue;
    if ((entry.kind || entry.type || "llm") !== "llm") continue;
    addLevels(entry.id);
  }
  return set.size ? ["auto", ...[...set]] : null;
}
