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
      <button type="button" onClick={() => onSelect(null)} className={cn("group relative flex w-full items-center justify-between gap-2 rounded-lg py-2 pl-3.5 pr-3 text-left text-sm font-medium transition-colors", selectedProviderId === null ? "bg-primary/10 text-primary" : "text-text-main hover:bg-muted/60")}>
        <span className={cn("absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary transition-opacity", selectedProviderId === null ? "opacity-100" : "opacity-0")} />
        <span>{translate("All providers") || "All providers"}</span>
        <span className={cn("text-xs tabular-nums", selectedProviderId === null ? "text-primary" : "text-text-muted")}>{totalCount}</span>
      </button>
      {sortedProviderIds.map((providerId) => (
        <button key={providerId} type="button" onClick={() => onSelect(providerId)} className={cn("group relative flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-3.5 pr-3 text-left text-sm transition-colors", selectedProviderId === providerId ? "bg-primary/10 text-primary" : "text-text-main hover:bg-muted/60")}>
          <span className={cn("absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary transition-opacity", selectedProviderId === providerId ? "opacity-100" : "opacity-0")} />
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/60">
            <ProviderIcon providerId={providerId} alt={groups[providerId].name} size={14} fallbackText={providerId.slice(0, 2).toUpperCase()} />
          </span>
          <span className="min-w-0 flex-1 truncate">{groups[providerId].name}</span>
          <span className={cn("shrink-0 text-xs tabular-nums", selectedProviderId === providerId ? "text-primary" : "text-text-muted")}>{groups[providerId].models.length}</span>
        </button>
      ))}
    </div>
  );
}

export function fmtPrice(n: number): string { return `$${n.toFixed(n < 1 ? 3 : 2)}`; }

export function priceTierBadge(price: ModelPriceInfo | undefined): { label: string; dotClassName: string } | null {
  if (!price || price.outputPrice === null) return null;
  const output = price.outputPrice;
  if (output === 0) return { label: translate("Free") || "Free", dotClassName: "bg-success" };
  if (output <= 0.5) return { label: translate("Cheap") || "Cheap", dotClassName: "bg-success" };
  if (output <= 4) return { label: translate("Medium") || "Medium", dotClassName: "bg-warning" };
  return { label: translate("Expensive") || "Expensive", dotClassName: "bg-destructive" };
}

export function priceLine(price: ModelPriceInfo | undefined): string {
  if (!price || price.inputPrice === null || price.outputPrice === null) return translate("price not catalogued") || "price not catalogued";
  return `${fmtPrice(price.inputPrice)} ${translate("input") || "input"} · ${fmtPrice(price.outputPrice)} ${translate("output") || "output"} / 1M`;
}
