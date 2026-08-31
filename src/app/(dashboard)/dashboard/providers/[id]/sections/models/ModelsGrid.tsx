"use client";

import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { getModelKind } from "@/shared/constants/models";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { CLEAR_ALL_MODELS_SENTINEL } from "../../hooks/useProviderModels";
import CompatibleModelsSection from "../../CompatibleModelsSection";
import ModelsList from "./ModelsList";
import SuggestedModelsSection from "./SuggestedModelsSection";
import DisabledModelsSection from "./DisabledModelsSection";
import { Download, Loader2, Plus } from "lucide-react";
import type { UseProviderModelsReturn } from "../../hooks/useProviderModels";
import type { Connection } from "../../types";

interface ModelsGridProps {
  providerId: string;
  providerStorageAlias: string;
  providerDisplayAlias: string;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  isFreeNoAuth: boolean;
  connections: Connection[];
  thinkingMode: string;
  modelsHook: UseProviderModelsReturn;
}

export default function ModelsGrid({
  providerId,
  providerStorageAlias,
  providerDisplayAlias,
  isCompatible,
  isAnthropicCompatible,
  isFreeNoAuth,
  connections,
  thinkingMode,
  modelsHook: m,
}: ModelsGridProps) {
  const { copied, copy } = useCopyToClipboard();

  if (isCompatible) {
    return (
      <CompatibleModelsSection
        providerStorageAlias={providerStorageAlias}
        providerDisplayAlias={providerDisplayAlias}
        modelAliases={m.modelAliases}
        customModels={m.customModels}
        copied={copied ?? undefined}
        onCopy={copy}
        onDeleteAlias={m.handleDeleteAlias}
        onAddCustomModel={(modelId: string) => m.handleAddCustomModel(modelId, "llm", providerStorageAlias)}
        onDeleteCustomModel={(modelId: string) => m.handleDeleteCustomModel(modelId, "llm", providerStorageAlias)}
        connections={connections}
        isAnthropic={isAnthropicCompatible}
      />
    );
  }

  const allModels = Array.from(new Map([
    ...m.models,
    ...m.kiloFreeModels.filter((fm) => !m.models.some((mm) => mm.id === fm.id)),
  ].filter((mm) => { const k = getModelKind(mm); return !k || k === "llm"; })
    .map((model) => [model.id, model] as const)).values());
  const disabledSet = new Set(m.disabledModelIds);
  const displayModels = allModels.filter((mm) => !disabledSet.has(mm.id));
  const knownModelsById = new Map([...m.staticModels, ...allModels].map((mm) => [mm.id, mm]));
  const disabledDisplayModels = [...new Set(m.disabledModelIds)]
    .filter((id) => id !== CLEAR_ALL_MODELS_SENTINEL)
    .map((id) => knownModelsById.get(id) || { id, name: id });
  const customModelRows = getProviderCustomModelRows({
    customModels: m.customModels.filter((model) => model.source !== "discovered"),
    modelAliases: m.modelAliases,
    providerAlias: providerStorageAlias,
    builtInModels: m.models,
    type: "llm",
  });
  const addedFullModels = new Set([
    ...Object.values(m.modelAliases),
    ...customModelRows.map((model: { fullModel: string }) => model.fullModel),
  ]);
  const hardcodedIds = new Set(m.models.map((mm) => mm.id));

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <ModelsList
        customModelRows={customModelRows}
        displayModels={displayModels}
        providerId={providerId}
        providerStorageAlias={providerStorageAlias}
        providerDisplayAlias={providerDisplayAlias}
        isFreeNoAuth={isFreeNoAuth}
        connectionCount={connections.length}
        modelAliases={m.modelAliases}
        modelTestResults={m.modelTestResults}
        testingModelIds={m.testingModelIds}
        thinkingMode={thinkingMode}
        onDeleteAlias={m.handleDeleteAlias}
        onDeleteCustomModel={m.handleDeleteCustomModel}
        onTestModel={m.handleTestModel}
        onDisableModel={m.handleDisableModel}
      />
      <Button variant="outline" onClick={() => m.setShowAddCustomModel(true)} className="min-h-20 w-full border-dashed border-primary/40 text-xs">
        <Plus className="size-4" />{translate("Add Model")}
      </Button>
      {providerId === "qoder" && connections.some((conn) => conn.isActive !== false) && (
        <Button variant="outline" onClick={m.handleImportQoderModels} disabled={m.importingQoderModels} className="min-h-20 w-full border-dashed border-blue-500/40 text-xs text-blue-600 dark:text-blue-400">
          <span className="text-sm" style={m.importingQoderModels ? { animation: "spin 1s linear infinite" } : undefined}>
            {m.importingQoderModels ? <Loader2 className="size-4" /> : <Download className="size-4" />}
          </span>
          {m.importingQoderModels ? translate("Fetching...") : translate("Fetch Qoder Models")}
        </Button>
      )}
      <SuggestedModelsSection suggestedModels={m.suggestedModels} disabledModelIds={m.disabledModelIds} addedFullModels={addedFullModels} hardcodedIds={hardcodedIds} providerStorageAlias={providerStorageAlias} onAdd={m.handleAddCustomModel} />
      <DisabledModelsSection disabledDisplayModels={disabledDisplayModels} onEnableModel={m.handleEnableModel} />
    </div>
  );
}
