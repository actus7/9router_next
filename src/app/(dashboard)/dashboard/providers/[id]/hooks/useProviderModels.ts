"use client";

import { useRef, useState } from "react";
import { getModelsByProviderId } from "@/shared/constants/models";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import { useDisabledModels } from "./useDisabledModels";
import { useCustomModels } from "./useCustomModels";
import { CLEAR_ALL_MODELS_SENTINEL } from "./modelConstants";
import { useModelDiscovery } from "./useModelDiscovery";
import { useModelTesting } from "./useModelTesting";
import { computeProviderThinkingLevels } from "./providerThinkingLevels";
import type { Connection, CustomModelEntry, LiveModel, ProviderNode } from "../types";

export { CLEAR_ALL_MODELS_SENTINEL } from "./modelConstants";

interface UseProviderModelsArgs {
  providerId: string;
  providerStorageAlias: string;
  providerAlias: string;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  connections: Connection[];
  providerNode: ProviderNode | null;
  initialAliases: Record<string, string>;
  initialCustomModels: CustomModelEntry[];
  initialDisabledModels: Record<string, string[]>;
}

export function useProviderModels({
  providerId, providerStorageAlias, providerAlias, isCompatible, isAnthropicCompatible,
  connections, providerNode, initialAliases, initialCustomModels, initialDisabledModels,
}: UseProviderModelsArgs) {
  const notify = useNotificationStore();
  const [showAddCustomModel, setShowAddCustomModel] = useState<boolean>(false);
  const setModelTestResultsRef = useRef<(v: Record<string, "ok" | "error">) => void>(() => {});

  const disabledHook = useDisabledModels({ providerStorageAlias, providerAlias, initialDisabledModels });
  const customHook = useCustomModels({ providerStorageAlias, initialAliases, initialCustomModels });

  const staticModels = getModelsByProviderId(providerId) as LiveModel[];
  const discoveredModels = Array.from(new Map(
    customHook.customModels
      .filter((model) => model.providerAlias === providerStorageAlias && model.source === "discovered" && (model.kind || model.type || "llm") === "llm")
      .map((model) => [model.id, { ...model, name: typeof model.name === "string" ? model.name : model.id } as LiveModel]),
  ).values());
  const catalogCleared = disabledHook.disabledModelIds.includes(CLEAR_ALL_MODELS_SENTINEL);

  const discoveryHook = useModelDiscovery({
    providerId, providerStorageAlias, isCompatible, isAnthropicCompatible, connections, providerNode,
    staticModels, catalogCleared, customModels: customHook.customModels, modelAliases: customHook.modelAliases,
    disabledModelIds: disabledHook.disabledModelIds, onAddCustomModel: customHook.handleAddCustomModel,
    onFetchDisabledModels: disabledHook.fetchDisabledModels, onClearTestResults: () => setModelTestResultsRef.current({}),
    setCustomModels: customHook.setCustomModels, setModelAliases: customHook.setModelAliases, setDisabledModelIds: disabledHook.setDisabledModelIds,
  });

  const models = catalogCleared ? [] : (discoveryHook.liveModels.length > 0 ? discoveryHook.liveModels : (discoveredModels.length > 0 ? discoveredModels : staticModels));

  const testingHook = useModelTesting({
    providerStorageAlias, providerId, models, kiloFreeModels: discoveryHook.kiloFreeModels,
    disabledModelIds: disabledHook.disabledModelIds,
    onDisableModels: async (ids: string[]) => {
      try {
        const response = await fetch("/api/models/disabled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerAlias: providerStorageAlias, ids }) });
        if (response.ok) { disabledHook.setDisabledModelIds((current) => [...new Set([...current, ...ids])]); notify.warning(`${ids.length} ${translate("model(s) no longer available upstream — moved to Disabled")}`); }
      } catch (error) { console.error("Error disabling definitively unavailable models:", error); }
    },
  });

  setModelTestResultsRef.current = testingHook.setModelTestResults;

  const providerThinkingLevels = computeProviderThinkingLevels(providerId, providerStorageAlias, models, discoveryHook.kiloFreeModels, customHook.customModels);

  return {
    modelAliases: customHook.modelAliases, customModels: customHook.customModels,
    modelTestResults: testingHook.modelTestResults, modelsTestError: testingHook.modelsTestError,
    testingModelIds: testingHook.testingModelIds, testAllModels: testingHook.testAllModels,
    setTestAllModels: testingHook.setTestAllModels, showAddCustomModel, setShowAddCustomModel,
    suggestedModels: discoveryHook.suggestedModels, liveModels: discoveryHook.liveModels,
    kiloFreeModels: discoveryHook.kiloFreeModels, disabledModelIds: disabledHook.disabledModelIds,
    refreshingModels: discoveryHook.refreshingModels, importingQoderModels: discoveryHook.importingQoderModels,
    clearingModels: discoveryHook.clearingModels, staticModels, models, providerThinkingLevels,
    fetchDisabledModels: disabledHook.fetchDisabledModels, handleDisableModel: disabledHook.handleDisableModel,
    handleEnableModel: disabledHook.handleEnableModel, handleDisableAll: disabledHook.handleDisableAll,
    handleEnableAll: disabledHook.handleEnableAll, handleClearProviderModels: discoveryHook.handleClearProviderModels,
    fetchAliases: customHook.fetchAliases, fetchCustomModels: customHook.fetchCustomModels,
    handleDeleteAlias: customHook.handleDeleteAlias, handleAddCustomModel: customHook.handleAddCustomModel,
    handleDeleteCustomModel: customHook.handleDeleteCustomModel, handleImportQoderModels: discoveryHook.handleImportQoderModels,
    handleRefreshModels: discoveryHook.handleRefreshModels, handleTestAllModels: testingHook.handleTestAllModels,
    handleCancelTestAllModels: testingHook.handleCancelTestAllModels, handleTestModel: testingHook.handleTestModel,
  };
}

export type UseProviderModelsReturn = ReturnType<typeof useProviderModels>;
