"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search, SearchX, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { getStoredModelTestLatencies, sortModelsByTestLatency, type ModelTestLatency } from "@/shared/utils/modelTestLatency";
import type { NormalizedModel, ProviderGroup } from "../types";

type SortMode = "default" | "fastest" | "alpha";

const SORT_OPTIONS: { mode: SortMode; label: string }[] = [
  { mode: "default", label: "Default" },
  { mode: "fastest", label: "Fastest" },
  { mode: "alpha", label: "A-Z" },
];

function sortModels(models: NormalizedModel[], mode: SortMode, latencies: Record<string, ModelTestLatency>): NormalizedModel[] {
  if (mode === "alpha") return [...models].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "fastest") return sortModelsByTestLatency(models, latencies);
  return models;
}

interface ChatModelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  providerGroups: ProviderGroup[];
  activeProviderId: string;
  activeModelId: string;
}

export default function ChatModelPickerModal({
  isOpen, onClose, onSelect, providerGroups, activeProviderId, activeModelId,
}: ChatModelPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(activeProviderId || null);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const query = searchQuery.trim().toLowerCase();
  const latencies = useMemo(() => (isOpen ? getStoredModelTestLatencies() : {}), [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      return;
    }
    setSelectedProviderId(activeProviderId || null);
  }, [isOpen, activeProviderId]);

  const visibleGroups = useMemo(() => providerGroups
    .filter((group) => !selectedProviderId || group.providerId === selectedProviderId)
    .map((group) => {
      const providerMatches = group.providerName.toLowerCase().includes(query);
      const models = query && !providerMatches
        ? group.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
        : group.models;
      return { ...group, models: sortModels(models, sortMode, latencies) };
    })
    .filter((group) => group.models.length > 0), [providerGroups, selectedProviderId, query, sortMode, latencies]);

  const totalModels = useMemo(() => providerGroups.reduce((total, group) => total + group.models.length, 0), [providerGroups]);
  const selectedModels = selectedProviderId ? visibleGroups[0]?.models || [] : [];

  const selectModel = (model: NormalizedModel) => {
    onSelect(model.id);
    onClose();
  };

  const renderModel = (model: NormalizedModel, provider: ProviderGroup, showProvider: boolean) => (
    <button
      key={model.id}
      type="button"
      onClick={() => selectModel(model)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        model.id === activeModelId ? "bg-primary/10 text-primary" : "hover:bg-muted text-text-main",
      )}
    >
      {showProvider ? <ProviderIcon providerId={provider.providerId} alt={provider.providerName} size={20} fallbackText={provider.providerName.slice(0, 2).toUpperCase()} /> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{model.name}</p>
        <p className="truncate text-xs text-text-muted">{showProvider ? provider.providerName : model.requestModel}</p>
      </div>
      {model.id === activeModelId ? <Check className="size-4 shrink-0" /> : null}
    </button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-3xl gap-0 overflow-hidden rounded-[14px] border border-border-subtle bg-surface p-0 shadow-[var(--shadow-elev)] ring-0">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border-subtle p-3 sm:p-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold text-text-main sm:text-lg">{translate("Choose model") || "Choose model"}</DialogTitle>
            {/* The subtitle only restates the dialog's purpose; on a phone that row
                costs more list rows than it explains. */}
            <p className="mt-0.5 hidden text-sm text-text-muted sm:block">{translate("Select an active provider and model for this conversation.") || "Select an active provider and model for this conversation."}</p>
          </div>
          <Button type="button" onClick={onClose} aria-label={translate("Close") || "Close"} variant="ghost" size="icon-sm" className="shrink-0"><X className="size-5" /></Button>
        </div>
        <div className="flex min-w-0 flex-col gap-2 border-b border-border-subtle p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={translate("Search by model or provider...") || "Search by model or provider..."} className="pl-9" autoFocus />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">{translate("Sort:") || "Sort:"}</span>
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => setSortMode(option.mode)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  sortMode === option.mode ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-muted hover:text-text-main",
                )}
              >
                {option.mode === "fastest" && <Zap className="size-3" />}
                {translate(option.label) || option.label}
              </button>
            ))}
          </div>
        </div>
        {/* min-w-0 is load-bearing: DialogContent is a grid, so without it these
            tracks size to the provider strip's max-content (~1500px with a dozen
            providers). The dialog's overflow-hidden then clipped everything to the
            right — including the close button — instead of the strip scrolling. */}
        <div className="flex min-h-0 min-w-0 max-h-[70dvh] flex-col sm:max-h-[60vh] sm:flex-row">
          {/* Below sm the provider list is a horizontal strip: as a fixed 13rem
              rail it left almost no width for the model names beside it. */}
          <aside className="flex w-full min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-border-subtle p-2 custom-scrollbar sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
            <button type="button" onClick={() => setSelectedProviderId(null)} className={cn("flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors sm:w-full", selectedProviderId === null ? "bg-primary text-primary-foreground" : "text-text-main hover:bg-muted")}>
              <span className="whitespace-nowrap">{translate("All providers") || "All providers"}</span><span className={cn("text-xs", selectedProviderId === null ? "text-primary-foreground/80" : "text-text-muted")}>{totalModels}</span>
            </button>
            {providerGroups.map((provider) => (
              <button key={provider.providerId} type="button" onClick={() => setSelectedProviderId(provider.providerId)} className={cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors sm:w-full", selectedProviderId === provider.providerId ? "bg-primary text-primary-foreground" : "text-text-main hover:bg-muted")}>
                <ProviderIcon providerId={provider.providerId} alt={provider.providerName} size={18} fallbackText={provider.providerName.slice(0, 2).toUpperCase()} />
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{provider.providerName}</span><span className={cn("text-xs", selectedProviderId === provider.providerId ? "text-primary-foreground/80" : "text-text-muted")}>{provider.models.length}</span>
              </button>
            ))}
          </aside>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
            {selectedProviderId && visibleGroups[0]
              ? selectedModels.map((model) => renderModel(model, visibleGroups[0]!, false))
              : visibleGroups.map((provider) => (
                <section key={provider.providerId} className="mb-3">
                  <div className="sticky top-0 flex items-center gap-1.5 bg-surface px-3 py-1.5 text-xs font-medium text-text-muted"><ProviderIcon providerId={provider.providerId} alt={provider.providerName} size={14} fallbackText={provider.providerName.slice(0, 2).toUpperCase()} /><span className="uppercase">{provider.providerName}</span><span>· {provider.models.length}</span></div>
                  {provider.models.map((model) => renderModel(model, provider, false))}
                </section>
              ))}
            {visibleGroups.length === 0 ? <div className="flex flex-col items-center gap-2 py-10 text-text-muted"><SearchX className="size-5" /><p className="text-sm">{translate("No models found") || "No models found"}</p></div> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
