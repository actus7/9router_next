"use client";

import ProviderIcon from "./ProviderIcon";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { PickerGroup } from "./buildProviderGroups";
import type { ModelPriceInfo } from "./TierModelPickerModal";

interface ProviderSidebarProps {
  sortedProviderIds: string[];
  groups: Record<string, PickerGroup>;
  selectedProviderId: string | null;
  totalCount: number;
  onSelect: (id: string | null) => void;
}

export function ProviderSidebar({ sortedProviderIds, groups, selectedProviderId, totalCount, onSelect }: ProviderSidebarProps) {
  return (
    <div className="w-56 shrink-0 overflow-y-auto border-r border-border-subtle p-2 custom-scrollbar">
      <button type="button" onClick={() => onSelect(null)} className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors", selectedProviderId === null ? "bg-primary text-primary-foreground" : "hover:bg-muted text-text-main")}>
        <span>{translate("All providers") || "All providers"}</span>
        <span className={cn("text-xs", selectedProviderId === null ? "text-primary-foreground/80" : "text-text-muted")}>{totalCount}</span>
      </button>
      {sortedProviderIds.map((providerId) => (
        <button key={providerId} type="button" onClick={() => onSelect(providerId)} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors", selectedProviderId === providerId ? "bg-primary text-primary-foreground" : "hover:bg-muted text-text-main")}>
          <ProviderIcon providerId={providerId} alt={groups[providerId].name} size={18} fallbackText={providerId.slice(0, 2).toUpperCase()} />
          <span className="min-w-0 flex-1 truncate">{groups[providerId].name}</span>
          <span className={cn("shrink-0 text-xs", selectedProviderId === providerId ? "text-primary-foreground/80" : "text-text-muted")}>{groups[providerId].models.length}</span>
        </button>
      ))}
    </div>
  );
}

export function fmtPrice(n: number): string { return `$${n.toFixed(n < 1 ? 3 : 2)}`; }

export function priceTierBadge(price: ModelPriceInfo | undefined): { label: string; className: string } | null {
  if (!price || price.outputPrice === null) return null;
  const output = price.outputPrice;
  if (output === 0) return { label: translate("Free") || "Free", className: "bg-emerald-500/15 text-emerald-500" };
  if (output <= 0.5) return { label: translate("Cheap") || "Cheap", className: "bg-emerald-500/15 text-emerald-500" };
  if (output <= 4) return { label: translate("Medium") || "Medium", className: "bg-amber-500/15 text-amber-500" };
  return { label: translate("Expensive") || "Expensive", className: "bg-red-500/15 text-red-500" };
}

export function priceLine(price: ModelPriceInfo | undefined): string {
  if (!price || price.inputPrice === null || price.outputPrice === null) return translate("price not catalogued") || "price not catalogued";
  return `${fmtPrice(price.inputPrice)} ${translate("input") || "input"} · ${fmtPrice(price.outputPrice)} ${translate("output") || "output"} / 1M`;
}
