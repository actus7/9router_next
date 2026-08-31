"use client";

import { useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Eye, Brain, Key, Users, Monitor, Search, X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useModelPickerFilters, TAB_DEFS } from "./useModelPickerFilters";
import ModelPickerGroupList from "./ModelPickerGroupList";

interface NormalizedModel {
  id: string;
  requestModel: string;
  name: string;
  providerId: string;
  providerName: string;
  source: string;
  caps?: Record<string, boolean>;
  kind?: string;
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerType: string;
  connections: Array<Record<string, unknown>>;
  models: NormalizedModel[];
}

interface ModelPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerGroups: ProviderGroup[];
  activeModelId: string;
  onSelect: (modelId: string) => void;
  loading?: boolean;
  error?: string;
}

// Icon map for tabs (kept here since it's JSX)
const TAB_ICONS: Record<string, React.ReactNode> = {
  subscription: <Users className="size-3.5 text-emerald-400" />,
  apikey: <Key className="size-3.5 text-amber-400" />,
  local: <Monitor className="size-3.5 text-pink-400" />,
};

const CAP_ICONS: Record<string, React.ReactNode> = {
  vision: <Eye className="size-3.5" />,
  reasoning: <Brain className="size-3.5" />,
};

const CAP_LABELS: Record<string, string> = {
  vision: "Vision",
  reasoning: "Reasoning",
};

export default function ModelPickerModal({
  open,
  onOpenChange,
  providerGroups,
  activeModelId,
  onSelect,
  loading = false,
  error = "",
}: ModelPickerModalProps) {
  const {
    search, setSearch,
    activeTab, setActiveTab,
    capFilter, toggleCap,
    searchRef,
    tabCounts,
    hasMultipleTabs,
    availableCaps,
    filteredGroups,
    totalModels,
    getCaps,
  } = useModelPickerFilters({ open, providerGroups });

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold">
            {translate("Select a model") || "Select a model"}
          </DialogTitle>
        </div>

        {/* Tabs */}
        {hasMultipleTabs && (
          <div className="shrink-0 border-b border-border px-4 pt-2">
            <div className="flex gap-1" role="tablist">
              {TAB_DEFS.map((tab) => {
                const count = tabCounts[tab.key];
                if (count === 0) return null;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    {TAB_ICONS[tab.key]}
                    {tab.label}
                    <span className="ml-0.5 text-[10px] text-muted-foreground">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translate("Search models or providers...") || "Search models or providers..."}
              className="h-9 pl-8 pr-8"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Capability filter pills */}
        {availableCaps.length > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 border-b border-border px-4 py-2">
            {availableCaps.map((cap) => {
              const isActive = capFilter.has(cap);
              return (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCap(cap)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                  )}
                >
                  {CAP_ICONS[cap]}
                  {CAP_LABELS[cap] || cap}
                </button>
              );
            })}
          </div>
        )}

        {/* Model list */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 custom-scrollbar">
          <ModelPickerGroupList
            filteredGroups={filteredGroups}
            activeModelId={activeModelId}
            onSelect={handleSelect}
            getCaps={getCaps}
            loading={loading}
            error={error}
            search={search}
          />
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-4 py-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {totalModels} model{totalModels !== 1 ? "s" : ""} available
          </span>
          <span className="text-[11px] text-muted-foreground">
            {translate("From connected providers") || "From connected providers"}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
