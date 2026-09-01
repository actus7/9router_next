"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Info, Search, X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useModelSelectData, type ActiveProvider } from "./useModelSelectData";
import ModelSelectGroupList from "./ModelSelectGroupList";

interface ModelItem {
  id: string;
  name: string;
  value: string;
  isPlaceholder?: boolean;
  isCustom?: boolean;
  kind?: string;
}

interface ModelSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (model: ModelItem | { value: string }) => void;
  onDeselect?: (model: ModelItem | { value: string }) => void;
  selectedModel?: string;
  activeProviders?: ActiveProvider[];
  title?: string;
  modelAliases?: Record<string, string>;
  kindFilter?: string | null;
  capFilter?: string | null;
  addedModelValues?: string[];
  closeOnSelect?: boolean;
}

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = translate("Select Model") || "Select Model",
  modelAliases = {},
  kindFilter = null,
  capFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
}: ModelSelectModalProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");

  const { filteredGroups, filteredCombos, getCaps } = useModelSelectData({
    isOpen,
    activeProviders,
    modelAliases,
    kindFilter,
    capFilter,
    addedModelValues,
    searchQuery,
  });

  const handleSelect = (model: ModelItem | { value?: string; name?: string }) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value as string);

    if (isAdded && onDeselect) {
      onDeselect(model as ModelItem);
    } else {
      onSelect(model as ModelItem);
    }

    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
        setSearchQuery("");
      }
    }}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-md",
          "p-4!"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            {title}
          </DialogTitle>
          <Button onClick={() => { onClose(); setSearchQuery(""); }} aria-label={translate("Close") ?? "Close"} variant="ghost" size="icon-sm">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
      {/* Info bar */}
      <div className="flex items-center gap-2 mb-3 px-2.5 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-text-muted">
        <Info className="size-3.5 text-primary shrink-0" />
        <span>{translate("Click to add, click again to remove. Changes are saved automatically.")}</span>
      </div>

      {/* Search - compact */}
      <div className="mb-3">
        <div className="relative">
          <Search className="size-4" />
          <Input
            type="text"
            placeholder={translate("Search...") || "Search..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
      </div>

      <ModelSelectGroupList
        filteredGroups={filteredGroups}
        filteredCombos={filteredCombos}
        selectedModel={selectedModel}
        addedModelValues={addedModelValues}
        onSelect={handleSelect}
        getCaps={getCaps}
      />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { ActiveProvider };
