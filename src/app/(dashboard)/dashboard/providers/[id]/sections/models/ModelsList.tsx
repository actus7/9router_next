"use client";

import { getThinkingLevels } from "@/shared/llm-catalog";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ModelRow from "../../ModelRow";
import type { LiveModel } from "../../types";

interface ModelRowItem {
  id: string;
  name?: string;
  alias?: string;
  source: string;
  fullModel: string;
}

interface ModelsListProps {
  customModelRows: ModelRowItem[];
  displayModels: LiveModel[];
  providerId: string;
  providerStorageAlias: string;
  providerDisplayAlias: string;
  isFreeNoAuth: boolean;
  connectionCount: number;
  modelAliases: Record<string, string>;
  modelTestResults: Record<string, "ok" | "error">;
  testingModelIds: Set<string>;
  thinkingMode: string;
  onDeleteAlias: (alias: string) => void;
  onDeleteCustomModel: (id: string, type: string, alias: string) => void;
  onTestModel: (id: string) => void;
  onDisableModel: (id: string) => void;
}

export default function ModelsList({
  customModelRows,
  displayModels,
  providerId,
  providerStorageAlias,
  providerDisplayAlias,
  isFreeNoAuth,
  connectionCount,
  modelAliases,
  modelTestResults,
  testingModelIds,
  thinkingMode,
  onDeleteAlias,
  onDeleteCustomModel,
  onTestModel,
  onDisableModel,
}: ModelsListProps) {
  const { getCaps } = useModelCaps();
  const { copied, copy } = useCopyToClipboard();

  const resolveThinkingSuffix = (modelId: string): string | null => {
    if (!thinkingMode || thinkingMode === "auto") return null;
    const levels = getThinkingLevels(providerId, modelId);
    return levels && levels.includes(thinkingMode) ? thinkingMode : null;
  };
  const getTestStatus = (modelId: string): "ok" | "error" | undefined => {
    const status = modelTestResults[modelId];
    return status === "ok" || status === "error" ? status : undefined;
  };

  return (
    <>
      {customModelRows.map((model) => (
        <ModelRow
          key={`${model.source}-${model.fullModel}`}
          model={{ id: model.id, name: model.name }}
          fullModel={`${providerDisplayAlias}/${model.id}`}
          alias={model.alias}
          copied={copied ?? undefined}
          onCopy={copy}
          onDeleteAlias={() => {
            if (model.source === "custom") onDeleteCustomModel(model.id, "llm", providerStorageAlias);
            else onDeleteAlias(model.alias!);
          }}
          testStatus={getTestStatus(model.id)}
          onTest={connectionCount > 0 || isFreeNoAuth ? () => onTestModel(model.id) : undefined}
          isTesting={testingModelIds.has(model.id)}
          isCustom
          isFree={false}
          caps={(getCaps(`${providerId}/${model.id}`) ?? undefined) as Record<string, unknown> | undefined}
          thinkingSuffix={resolveThinkingSuffix(model.id)}
        />
      ))}
      {displayModels.map((model) => {
        const fullModel = `${providerStorageAlias}/${model.id}`;
        const oldFormatModel = `${providerId}/${model.id}`;
        const existingAlias = Object.entries(modelAliases).find(([, mv]) => mv === fullModel || mv === oldFormatModel)?.[0];
        return (
          <ModelRow
            key={`model-${model.id}`}
            model={model}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={existingAlias}
            copied={copied ?? undefined}
            onCopy={copy}
            onDeleteAlias={() => onDeleteAlias(existingAlias!)}
            testStatus={getTestStatus(model.id)}
            onTest={connectionCount > 0 || isFreeNoAuth ? () => onTestModel(model.id) : undefined}
            isTesting={testingModelIds.has(model.id)}
            isFree={(model as Record<string, unknown>).isFree as boolean}
            onDisable={() => onDisableModel(model.id)}
            caps={(getCaps(`${providerId}/${model.id}`) ?? undefined) as Record<string, unknown> | undefined}
            thinkingSuffix={resolveThinkingSuffix(model.id)}
          />
        );
      })}
    </>
  );
}
