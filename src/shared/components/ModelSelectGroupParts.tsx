"use client";

import Button from "@/shared/components/Button";
import CapacityBadges from "./CapacityBadges";
import { Check, Layers, Pencil } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface ModelItem { id: string; name: string; value: string; isPlaceholder?: boolean; isCustom?: boolean; kind?: string; }

interface ComboSectionProps {
  combos: { id: string; name: string }[];
  selectedModel?: string; addedModelValues: string[];
  onSelect: (model: { value: string }) => void;
}

export function ComboSection({ combos, selectedModel, addedModelValues, onSelect }: ComboSectionProps) {
  if (combos.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
        <Layers className="size-4" /><span className="text-xs font-medium text-primary">Combos</span><span className="text-[10px] text-text-muted">({combos.length})</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {combos.map((combo) => {
          const isSelected = selectedModel === combo.name;
          const isAdded = addedModelValues.includes(combo.name);
          return (
            <Button key={combo.id} onClick={() => onSelect({ value: combo.name })} variant={isSelected || isAdded ? "default" : "outline"} size="sm"
              className={`px-2 py-1 rounded-xl text-xs font-medium hover:cursor-pointer flex items-center gap-1 ${isSelected ? "bg-primary text-white border-primary" : isAdded ? "bg-primary border-primary text-white hover:bg-primary-hover" : ""}`}>
              {isAdded && <Check className="size-2.5" />}{combo.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

interface ModelButtonProps {
  model: ModelItem; selectedModel?: string; addedModelValues: string[];
  onSelect: (model: ModelItem) => void;
  getCaps: (value: string) => Record<string, boolean> | null;
}

export function ModelButton({ model, selectedModel, addedModelValues, onSelect, getCaps }: ModelButtonProps) {
  const isSelected = selectedModel === model.value;
  const isAdded = addedModelValues.includes(model.value);
  return (
    <Button key={model.value} onClick={() => onSelect(model)}
      title={model.isPlaceholder ? (translate("Select to fill, then edit the model ID in the field") || "Select to fill, then edit the model ID in the field") : undefined}
      variant={model.isPlaceholder ? "outline" : isSelected || isAdded ? "default" : "outline"} size="sm"
      className={`px-2 py-1 rounded-xl text-xs font-medium hover:cursor-pointer ${model.isPlaceholder ? "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic" : isSelected ? "bg-primary text-white border-primary" : isAdded ? "bg-primary border-primary text-white hover:bg-primary-hover" : ""}`}>
      <span className="flex items-center gap-1">
        {isAdded && !model.isPlaceholder && <Check className="size-2.5" />}
        {model.isPlaceholder ? (<><Pencil className="size-3" />{model.name}</>) : model.isCustom ? (<>{model.name}<span className="text-[9px] opacity-60 font-normal">{translate("Custom") || "Custom"}</span><CapacityBadges caps={getCaps(model.value) as Record<string, boolean> | null} /></>) : (<> {model.name}<CapacityBadges caps={getCaps(model.value) as Record<string, boolean> | null} /></>)}
      </span>
    </Button>
  );
}
