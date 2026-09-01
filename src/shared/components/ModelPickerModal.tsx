"use client";

import { useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useModelPickerFilters } from "./useModelPickerFilters";
import ModelPickerGroupList from "./ModelPickerGroupList";
import { PickerTabs, CapFilterPills } from "./ModelPickerParts";

interface NormalizedModel { id: string; requestModel: string; name: string; providerId: string; providerName: string; source: string; caps?: Record<string, boolean>; kind?: string; }
interface ProviderGroup { providerId: string; providerName: string; providerType: string; connections: Array<Record<string, unknown>>; models: NormalizedModel[]; }
interface ModelPickerModalProps { open: boolean; onOpenChange: (open: boolean) => void; providerGroups: ProviderGroup[]; activeModelId: string; onSelect: (modelId: string) => void; loading?: boolean; error?: string; }

export default function ModelPickerModal({ open, onOpenChange, providerGroups, activeModelId, onSelect, loading = false, error = "" }: ModelPickerModalProps) {
  const { search, setSearch, activeTab, setActiveTab, capFilter, toggleCap, searchRef, tabCounts, hasMultipleTabs, availableCaps, filteredGroups, totalModels, getCaps } = useModelPickerFilters({ open, providerGroups });
  const handleSelect = useCallback((id: string) => { onSelect(id); onOpenChange(false); }, [onSelect, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="shrink-0 border-b border-border px-5 py-4"><DialogTitle className="text-base font-semibold">{translate("Select a model") || "Select a model"}</DialogTitle></div>
        <PickerTabs activeTab={activeTab} setActiveTab={setActiveTab} tabCounts={tabCounts} hasMultipleTabs={hasMultipleTabs} />
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={translate("Search models or providers...") || "Search models or providers..."} className="h-9 pl-8 pr-8" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>}
          </div>
        </div>
        <CapFilterPills availableCaps={availableCaps} capFilter={capFilter} toggleCap={toggleCap} />
        <div className="flex-1 min-h-0 overflow-y-auto p-2 custom-scrollbar">
          <ModelPickerGroupList filteredGroups={filteredGroups} activeModelId={activeModelId} onSelect={handleSelect} getCaps={getCaps} loading={loading} error={error} search={search} />
        </div>
        <div className="shrink-0 border-t border-border px-4 py-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{totalModels} model{totalModels !== 1 ? "s" : ""} available</span>
          <span className="text-[11px] text-muted-foreground">{translate("From connected providers") || "From connected providers"}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
