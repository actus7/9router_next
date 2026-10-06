import type { ReactNode } from "react";
import { sortModelsByTestLatency, type ModelTestLatency } from "@/shared/utils/modelTestLatency";

/** One selectable model in the picker. `key` is what `onPick` hands back. */
export interface PickerModel {
  key: string;
  name: string;
  /** Second line, e.g. the request model id. */
  subtitle?: string;
  /** Capability icons and the like, shown after the name. */
  badges?: ReactNode;
  /** A user-defined model (tagged "Custom"). */
  custom?: boolean;
  /** An empty slot the user fills and then edits, not a real model. */
  placeholder?: boolean;
}

export interface PickerGroup {
  id: string;
  name: string;
  /** Icon looked up by provider id; falls back to the group's initials. */
  iconProviderId?: string;
  models: PickerModel[];
}

export type PickerSortMode = "default" | "fastest" | "alpha";

/** Search across providers: a provider-name hit keeps all of its models. */
export function filterPickerGroups(groups: PickerGroup[], query: string): PickerGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => {
      if (group.name.toLowerCase().includes(q)) return group;
      return { ...group, models: group.models.filter((m) => `${m.name} ${m.key}`.toLowerCase().includes(q)) };
    })
    .filter((group) => group.models.length > 0);
}

export function sortPickerModels(
  models: PickerModel[],
  mode: PickerSortMode,
  latencies: Record<string, ModelTestLatency>,
): PickerModel[] {
  if (mode === "alpha") return [...models].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "fastest") {
    // The latency table is keyed by lower-cased model id, which is the picker key.
    return sortModelsByTestLatency(models.map((m) => ({ ...m, id: m.key })), latencies);
  }
  return models;
}
