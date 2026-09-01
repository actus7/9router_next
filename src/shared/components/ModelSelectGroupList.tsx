"use client";

import ProviderIcon from "./ProviderIcon";
import { SearchX } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { ComboSection, ModelButton } from "./ModelSelectGroupParts";

interface ModelItem { id: string; name: string; value: string; isPlaceholder?: boolean; isCustom?: boolean; kind?: string; }
interface ModelGroup { name: string; alias: string; color: string; models: ModelItem[]; isCustom?: boolean; hasModels?: boolean; }

interface ModelSelectGroupListProps {
  filteredGroups: Record<string, ModelGroup>;
  filteredCombos: { id: string; name: string }[];
  selectedModel?: string; addedModelValues: string[];
  onSelect: (model: ModelItem | { value: string }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCaps: (value: string) => any;
}

export default function ModelSelectGroupList({ filteredGroups, filteredCombos, selectedModel, addedModelValues, onSelect, getCaps }: ModelSelectGroupListProps) {
  return (
    <div className="max-h-[400px] overflow-y-auto flex flex-col gap-3">
      <ComboSection combos={filteredCombos} selectedModel={selectedModel} addedModelValues={addedModelValues} onSelect={onSelect} />
      {Object.entries(filteredGroups).map(([providerId, group]) => (
        <div key={providerId}>
          <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
            <ProviderIcon src={`/providers/${providerId}.png`} alt={group.name} size={14} fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()} fallbackColor={group.color} />
            <span className="text-xs font-medium text-primary">{group.name}</span>
            <span className="text-[10px] text-text-muted">({group.models.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.models.map((model) => <ModelButton key={model.value} model={model} selectedModel={selectedModel} addedModelValues={addedModelValues} onSelect={onSelect} getCaps={getCaps} />)}
          </div>
        </div>
      ))}
      {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
        <div className="text-center py-4 text-text-muted"><SearchX className="size-4" /><p className="text-xs">{translate("No models found") || "No models found"}</p></div>
      )}
    </div>
  );
}


