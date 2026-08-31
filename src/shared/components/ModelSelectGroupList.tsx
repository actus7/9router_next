"use client";

import { cn } from "@/lib/utils";
import Button from "@/shared/components/Button";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { Check, Layers, Pencil, SearchX } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface ModelItem {
  id: string;
  name: string;
  value: string;
  isPlaceholder?: boolean;
  isCustom?: boolean;
  kind?: string;
}

interface ModelGroup {
  name: string;
  alias: string;
  color: string;
  models: ModelItem[];
  isCustom?: boolean;
  hasModels?: boolean;
}

interface ModelSelectGroupListProps {
  filteredGroups: Record<string, ModelGroup>;
  filteredCombos: { id: string; name: string }[];
  selectedModel?: string;
  addedModelValues: string[];
  onSelect: (model: ModelItem | { value: string }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCaps: (value: string) => any;
}

export default function ModelSelectGroupList({
  filteredGroups,
  filteredCombos,
  selectedModel,
  addedModelValues,
  onSelect,
  getCaps,
}: ModelSelectGroupListProps) {
  return (
    <div className="max-h-[400px] overflow-y-auto space-y-3">
      {/* Combos section */}
      {filteredCombos.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
            <Layers className="size-4" />
            <span className="text-xs font-medium text-primary">Combos</span>
            <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filteredCombos.map((combo) => {
              const isSelected = selectedModel === combo.name;
              return (
                <Button
                  key={combo.id}
                  onClick={() => onSelect({ id: combo.name, name: combo.name, value: combo.name })}
                  variant={isSelected || addedModelValues.includes(combo.name) ? "default" : "outline"}
                  size="sm"
                  className={`
                    px-2 py-1 rounded-xl text-xs font-medium hover:cursor-pointer flex items-center gap-1
                    ${isSelected
                      ? "bg-primary text-white border-primary"
                      : addedModelValues.includes(combo.name)
                        ? "bg-primary border-primary text-white hover:bg-primary-hover"
                        : ""
                    }
                  `}
                >
                  {addedModelValues.includes(combo.name) && (
                    <Check className="size-2.5" />
                  )}
                  {combo.name}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* Provider models */}
      {Object.entries(filteredGroups).map(([providerId, group]) => (
        <div key={providerId}>
          {/* Provider header */}
          <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
            <ProviderIcon
              src={`/providers/${providerId}.png`}
              alt={group.name}
              size={14}
              fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
              fallbackColor={group.color}
            />
            <span className="text-xs font-medium text-primary">
              {group.name}
            </span>
            <span className="text-[10px] text-text-muted">
              ({group.models.length})
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {group.models.map((model) => {
              const isSelected = selectedModel === model.value;
              const isPlaceholder = model.isPlaceholder;
              return (
                <Button
                  key={model.value}
                  onClick={() => onSelect(model)}
                  title={isPlaceholder ? (translate("Select to fill, then edit the model ID in the field") || "Select to fill, then edit the model ID in the field") : undefined}
                  variant={isPlaceholder ? "outline" : isSelected || addedModelValues.includes(model.value) ? "default" : "outline"}
                  size="sm"
                  className={`
                    px-2 py-1 rounded-xl text-xs font-medium hover:cursor-pointer
                    ${isPlaceholder
                      ? "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic"
                      : isSelected
                        ? "bg-primary text-white border-primary"
                        : addedModelValues.includes(model.value)
                          ? "bg-primary border-primary text-white hover:bg-primary-hover"
                          : ""
                    }
                  `}
                >
                  <span className="flex items-center gap-1">
                    {addedModelValues.includes(model.value) && !isPlaceholder && (
                      <Check className="size-2.5" />
                    )}
                    {isPlaceholder ? (
                      <>
                        <Pencil className="size-3" />
                        {model.name}
                      </>
                    ) : model.isCustom ? (
                      <>
                        {model.name}
                        <span className="text-[9px] opacity-60 font-normal">{translate("Custom") || "Custom"}</span>
                        <CapacityBadges caps={getCaps(model.value) as Record<string, boolean> | null} />
                      </>
                    ) : (
                      <>
                        {model.name}
                        <CapacityBadges caps={getCaps(model.value) as Record<string, boolean> | null} />
                      </>
                    )}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ))}

      {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
        <div className="text-center py-4 text-text-muted">
          <SearchX className="size-4" />
          <p className="text-xs">{translate("No models found") || "No models found"}</p>
        </div>
      )}
    </div>
  );
}
