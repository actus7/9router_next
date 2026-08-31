import type { LucideIcon } from "lucide-react";
import { AudioLines, Eye } from "lucide-react";
import type { Combo, Connection, Settings } from "@/lib/data-access";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { translate } from "@/i18n/runtime";

// Validate combo name: only a-z, A-Z, 0-9, -, _
export const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export interface CapEntry {
  enabled: boolean;
  roundRobin: boolean;
  models: string[];
}

export interface Strategy {
  fallbackStrategy?: string;
  judgeModel?: string;
}

export interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

export interface CombosClientProps {
  initialCombos: Combo[];
  initialProviders: Connection[];
  initialSettings: Settings;
  initialAliases: Record<string, string>;
}

export type ComboView = Omit<Combo, "models"> & { models: string[] };
export type ModelCapsGetter = ReturnType<typeof useModelCaps>["getCaps"];

export interface CapacityAdapterDefinition {
  key: string;
  label: string;
  icon: LucideIcon;
  desc: string;
}

export function normalizeCombos(raw: Combo[] | undefined): ComboView[] {
  return (raw || [])
    .filter((combo) => !combo.kind || combo.kind === "llm" || combo.kind === "smart")
    .map((combo) => ({
      ...combo,
      models: Array.isArray(combo.models)
        ? combo.models.filter((model): model is string => typeof model === "string")
        : [],
    }));
}

// Capacity adapter: global fallback pools of models per input-modality capability.
export const CAPACITY_ADAPTER_CAPS: CapacityAdapterDefinition[] = [
  { key: "vision", label: "Vision", icon: Eye, desc: "Images" },
  { key: "audioInput", label: "Audio", icon: AudioLines, desc: "Audio input" },
];
export const EMPTY_CAP_ENTRY: CapEntry = { enabled: true, roundRobin: false, models: [] };

// Backward-compat: legacy stored form was an array of {model, enabled}.
function normalizeCapEntry(entry: unknown): CapEntry {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => (e as Record<string, unknown>)?.model || e).filter(Boolean) as string[] };
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    return {
      enabled: obj.enabled !== false,
      roundRobin: !!obj.roundRobin,
      models: Array.isArray(obj.models) ? (obj.models as unknown[]).filter(Boolean) as string[] : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

export function normalizeCapacityAdapter(raw: Record<string, unknown> | undefined): Record<string, CapEntry> {
  const rawAdapter = raw || {};
  const normalized: Record<string, CapEntry> = {};
  for (const cap of CAPACITY_ADAPTER_CAPS) {
    normalized[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
  }
  return normalized;
}

export const STRATEGY_OPTIONS = [
  { value: "fallback", label: translate("Fallback — try in order") || "Fallback — try in order" },
  { value: "round-robin", label: translate("Round Robin — rotate") || "Round Robin — rotate" },
  { value: "fusion", label: translate("Fusion — panel + judge") || "Fusion — panel + judge" },
];
