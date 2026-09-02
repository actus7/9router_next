"use client";

import { Button } from "@/components/ui/button";
import { Star, X } from "lucide-react";

interface ModelTagListProps {
  selectedModels: string[];
  activeModel: string;
  onToggleActive: (model: string) => void;
  onRemoveModel: (model: string) => void;
  onAddModel: () => void;
  hasActiveProviders: boolean;
}

export function ModelTagList({
  selectedModels, activeModel, onToggleActive, onRemoveModel, onAddModel, hasActiveProviders,
}: ModelTagListProps) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
      <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
      <span className="inline-flex items-center justify-center size-4 text-text-muted">→</span>
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
          {selectedModels.length === 0 ? (
            <span className="text-xs text-text-muted">No models selected</span>
          ) : (
            selectedModels.map((model) => (
              <span
                key={model}
                onClick={() => onToggleActive(model)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                  model === activeModel
                    ? "bg-primary/10 text-primary border border-primary"
                    : "bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border"
                }`}
                title={model === activeModel ? "Click to clear active model" : "Click to set as active"}
              >
                {model === activeModel && <Star className="size-3" />}
                {model}
                <Button variant="ghost" size="sm"
                  onClick={(e) => { e.stopPropagation(); onRemoveModel(model); }}
                  className="ml-0.5 hover:text-destructive-foreground p-0 h-auto"
                >
                  <X className="size-3" />
                </Button>
              </span>
            ))
          )}
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
          <Button variant="outline" size="sm" onClick={onAddModel} disabled={!hasActiveProviders}>Add Model</Button>
          <span className="text-xs text-text-muted">
            {selectedModels.length > 0 && activeModel ? (
              <>Active: <span className="text-primary">{activeModel}</span></>
            ) : selectedModels.length > 0 ? (
              <span className="text-warning">Click a model to set/clear active</span>
            ) : (
              "Select models to add"
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
