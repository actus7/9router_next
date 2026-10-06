"use client";

import { useMemo } from "react";
import { translate } from "@/i18n/runtime";
import ModelPickerShell from "./model-picker/ModelPickerShell";
import type { PickerGroup, PickerModel } from "./model-picker/modelPickerData";
import CapacityBadges from "./CapacityBadges";
import { useModelSelectData, type ActiveProvider } from "./useModelSelectData";
import { useSystemOneModels } from "@/shared/hooks/useSystemOneModels";

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
  /** Also list the System One (typed-decision) models, for places that accept one (a Fusion judge, the tiebreaker). */
  includeSystemOne?: boolean;
  /** What a System One pick means here (judge picks, tiebreaker classifies…), shown above the list. */
  systemOneNote?: string;
}

/** Pseudo-provider that holds the account's combos, as the chat's picker shows them. */
const COMBO_GROUP_ID = "modelhub";
/** Pseudo-provider that holds the System One models. */
const SYSTEM_ONE_GROUP_ID = "typesafe-ai";

/**
 * "Select a model" for the whole dashboard (combos, CLI tools, smart routing…).
 * It keeps its contract — `onSelect`/`onDeselect` against `addedModelValues`,
 * `closeOnSelect`, kind/capability filters — and renders through the shared
 * model picker, the same one the chat uses.
 */
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
  includeSystemOne = false,
  systemOneNote,
}: ModelSelectModalProps) {
  // Search is the picker's own: it filters the groups built here.
  const { filteredGroups, filteredCombos, getCaps } = useModelSelectData({
    isOpen,
    activeProviders,
    modelAliases,
    kindFilter,
    capFilter,
    addedModelValues,
    searchQuery: "",
  });

  const { data: systemOne } = useSystemOneModels(includeSystemOne && isOpen);

  const groups = useMemo<PickerGroup[]>(() => {
    const combos: PickerGroup[] = filteredCombos.length
      ? [{
        id: COMBO_GROUP_ID,
        name: "ModelHub",
        models: filteredCombos.map((combo) => ({ key: combo.name, name: combo.name })),
      }]
      : [];
    const providers: PickerGroup[] = Object.entries(filteredGroups).map(([providerId, group]) => ({
      id: providerId,
      name: group.name || providerId,
      models: group.models.map((model) => ({
        key: model.value,
        name: model.name,
        subtitle: model.isPlaceholder ? undefined : model.value,
        custom: model.isCustom,
        placeholder: model.isPlaceholder,
        badges: <CapacityBadges caps={getCaps(model.value) as Record<string, boolean> | null} />,
      })),
    }));
    const systemOneGroup: PickerGroup[] = includeSystemOne && systemOne?.models.length
      ? [{
        id: SYSTEM_ONE_GROUP_ID,
        name: "System One",
        models: systemOne.models.map((model) => ({ key: model.id, name: model.name, subtitle: model.id })),
      }]
      : [];
    return [...combos, ...systemOneGroup, ...providers];
  }, [filteredCombos, filteredGroups, getCaps, includeSystemOne, systemOne]);

  const selectedKeys = useMemo(
    () => (selectedModel ? [selectedModel, ...addedModelValues] : addedModelValues),
    [selectedModel, addedModelValues],
  );
  // A single choice opens on its provider so it is in view; a multi-select list
  // opens on every provider, since the added models can sit in any of them.
  const initialGroupId = useMemo(() => {
    if (!selectedModel) return null;
    return groups.find((group) => group.models.some((model) => model.key === selectedModel))?.id ?? null;
  }, [groups, selectedModel]);

  const handlePick = (model: PickerModel, group: PickerGroup) => {
    // Callers read `id`/`name`/`isCustom` off the model, as they did from the chip list;
    // combos have no such record, only their name.
    const item = filteredGroups[group.id]?.models.find((m) => m.value === model.key) ?? { value: model.key };
    if (addedModelValues.includes(model.key) && onDeselect) onDeselect(item);
    else onSelect(item);
    if (closeOnSelect) onClose();
  };

  return (
    <ModelPickerShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      note={closeOnSelect
        ? (includeSystemOne ? systemOneNote : undefined)
        : translate("Click to add, click again to remove. Changes are saved automatically.")}
      groups={groups}
      selectedKeys={selectedKeys}
      initialGroupId={initialGroupId}
      onPick={handlePick}
    />
  );
}

export type { ActiveProvider };
