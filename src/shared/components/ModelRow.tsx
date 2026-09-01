"use client";

import { cn } from "@/lib/utils";
import CapacityBadges from "./CapacityBadges";
import { CAPACITY_META, type CapacityKey } from "@/shared/constants/models";
import { Check } from "lucide-react";

interface NormalizedModel {
  id: string; requestModel: string; name: string; providerId: string;
  providerName: string; source: string; caps?: Record<string, boolean>; kind?: string;
}

interface ModelRowProps {
  model: NormalizedModel; activeModelId: string;
  onSelect: (id: string) => void;
  getCaps: (requestModel: string) => Record<string, boolean> | null;
}

export function ModelRow({ model, activeModelId, onSelect, getCaps }: ModelRowProps) {
  const isActive = model.id === activeModelId;
  const caps = getCaps(model.requestModel) || model.caps;
  const activeCaps = caps ? (Object.keys(CAPACITY_META) as CapacityKey[]).filter((k) => caps[k]) : [];
  return (
    <button type="button" onClick={() => onSelect(model.id)} className={cn("group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors w-full", isActive ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/60")}>
      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{model.name}</p><p className="text-[11px] text-muted-foreground truncate font-mono">{model.requestModel}</p></div>
      <div className="shrink-0 w-20 flex items-center justify-center">{activeCaps.length > 0 ? <CapacityBadges caps={caps} size={14} /> : <span className="text-[10px] text-muted-foreground/40">—</span>}</div>
      <div className="shrink-0 w-20 flex items-center justify-end"><span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium", model.source === "configured" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>{model.source === "configured" ? "Configured" : "Available"}</span></div>
      {isActive && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}
