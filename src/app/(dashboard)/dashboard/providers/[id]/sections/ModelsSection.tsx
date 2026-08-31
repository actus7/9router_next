"use client";

import { useState } from "react";
import { Card, Button, Modal } from "@/shared/components";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { translate } from "@/i18n/runtime";
import { getThinkingLevels } from "@/shared/llm-catalog";
import { getModelKind } from "@/shared/constants/models";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { CLEAR_ALL_MODELS_SENTINEL } from "../hooks/useProviderModels";
import ModelRow from "../ModelRow";
import CompatibleModelsSection from "../CompatibleModelsSection";
import AddCustomModelModal from "../AddCustomModelModal";
import {
  Ban,
  Beaker,
  Check,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X as XIcon,
} from "lucide-react";
import type { UseProviderModelsReturn } from "../hooks/useProviderModels";
import type { Connection } from "../types";

interface ModelsSectionProps {
  providerId: string;
  providerStorageAlias: string;
  providerDisplayAlias: string;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  isFreeNoAuth: boolean;
  connections: Connection[];
  thinkingMode: string;
  onThinkingModeChange: (mode: string) => void;
  noModelDiscovery?: boolean;
  modelsHook: UseProviderModelsReturn;
}

export default function ModelsSection({
  providerId,
  providerStorageAlias,
  providerDisplayAlias,
  isCompatible,
  isAnthropicCompatible,
  isFreeNoAuth,
  connections,
  thinkingMode,
  onThinkingModeChange,
  noModelDiscovery,
  modelsHook: m,
}: ModelsSectionProps) {
  const { getCaps } = useModelCaps();
  const { copied, copy } = useCopyToClipboard();
  const [showClearConfirmation, setShowClearConfirmation] = useState(false);

  // Resolve suffix "(level)" for a model when a thinking level is picked and the model supports it.
  const resolveThinkingSuffix = (modelId: string): string | null => {
    if (!thinkingMode || thinkingMode === "auto") return null;
    const levels = getThinkingLevels(providerId, modelId);
    return levels && levels.includes(thinkingMode) ? thinkingMode : null;
  };

  const renderModelsSection = () => {
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
    // Combine hardcoded models with Kilo free models (deduplicated)
    // Exclude non-llm models (embedding, tts, etc.) — they have dedicated pages under media-providers
    const allModels = Array.from(new Map([
      ...m.models,
      ...m.kiloFreeModels.filter((fm) => !m.models.some((mm) => mm.id === fm.id)),
    ].filter((mm) => { const k = getModelKind(mm); return !k || k === "llm"; })
      .map((model) => [model.id, model] as const)).values());
    const disabledSet = new Set(m.disabledModelIds);
    const displayModels = allModels.filter((mm) => !disabledSet.has(mm.id));
    // Disabled models can fall out of the live catalog entirely (e.g. Refresh
    // Models auto-disables ids the upstream no longer returns), so fall back
    // to the static registry for their metadata instead of only looking at
    // the just-fetched allModels — otherwise a disabled id with no match in
    // the current fetch silently disappears from this list.
    const knownModelsById = new Map([...m.staticModels, ...allModels].map((mm) => [mm.id, mm]));
    const disabledDisplayModels = [...new Set(m.disabledModelIds)]
      .filter((id) => id !== CLEAR_ALL_MODELS_SENTINEL)
      .map((id) => knownModelsById.get(id) || { id, name: id });
    const customModelRows = getProviderCustomModelRows({
      // Discovered records are the persisted live catalogue rendered below;
      // only user-created entries belong in the separate custom-model area.
      customModels: m.customModels.filter((model) => model.source !== "discovered"),
      modelAliases: m.modelAliases,
      providerAlias: providerStorageAlias,
      builtInModels: m.models,
      type: "llm",
    });

    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {/* Custom models first */}
        {customModelRows.map((model: { id: string; name?: string; alias?: string; source: string; fullModel: string }) => (
          <ModelRow
            key={`${model.source}-${model.fullModel}`}
            model={{ id: model.id, name: model.name }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied ?? undefined}
            onCopy={copy}
            onDeleteAlias={() => {
              if (model.source === "custom") {
                m.handleDeleteCustomModel(model.id, "llm", providerStorageAlias);
              } else {
                m.handleDeleteAlias(model.alias!);
              }
            }}
            testStatus={m.modelTestResults[model.id]}
            onTest={connections.length > 0 || isFreeNoAuth ? () => m.handleTestModel(model.id) : undefined}
            isTesting={m.testingModelIds.has(model.id)}
            isCustom
            isFree={false}
            caps={(getCaps(`${providerId}/${model.id}`) ?? undefined) as Record<string, unknown> | undefined}
            thinkingSuffix={resolveThinkingSuffix(model.id)}
          />
        ))}

        {displayModels.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(m.modelAliases).find(
            ([, mv]) => mv === fullModel || mv === oldFormatModel
          )?.[0];
          return (
            <ModelRow
              key={`model-${model.id}`}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied ?? undefined}
              onCopy={copy}
              onDeleteAlias={() => m.handleDeleteAlias(existingAlias!)}
              testStatus={m.modelTestResults[model.id]}
              onTest={connections.length > 0 || isFreeNoAuth ? () => m.handleTestModel(model.id) : undefined}
              isTesting={m.testingModelIds.has(model.id)}
              isFree={(model as Record<string, unknown>).isFree as boolean}
              onDisable={() => m.handleDisableModel(model.id)}
              caps={(getCaps(`${providerId}/${model.id}`) ?? undefined) as Record<string, unknown> | undefined}
              thinkingSuffix={resolveThinkingSuffix(model.id)}
            />
          );
        })}

        {/* Add model button — inline, same style as model chips */}
        <Button
          variant="outline"
          onClick={() => m.setShowAddCustomModel(true)}
          className="min-h-20 w-full border-dashed border-primary/40 text-xs"
        >
          <Plus className="size-4" />
          {translate("Add Model")}
        </Button>

        {/* Import Qoder models button — only show for qoder provider */}
        {providerId === "qoder" && connections.some((conn) => conn.isActive !== false) && (
          <Button
            variant="outline"
            onClick={m.handleImportQoderModels}
            disabled={m.importingQoderModels}
            className="min-h-20 w-full border-dashed border-blue-500/40 text-xs text-blue-600 dark:text-blue-400"
          >
            <span className="text-sm" style={m.importingQoderModels ? { animation: "spin 1s linear infinite" } : undefined}>
              {m.importingQoderModels ? <Loader2 className="size-4" /> : <Download className="size-4" />}
            </span>
            {m.importingQoderModels ? translate("Fetching...") : translate("Fetch Qoder Models")}
          </Button>
        )}

        {/* Suggested models from provider API — show only models not yet added */}
        {m.suggestedModels.length > 0 && (() => {
          const addedFullModels = new Set([
            ...Object.values(m.modelAliases),
            ...customModelRows.map((model: { fullModel: string }) => model.fullModel),
          ]);
          const hardcodedIds = new Set(m.models.map((mm) => mm.id));
          const notAdded = m.suggestedModels.filter(
            (mm) => !m.disabledModelIds.includes(mm.id) && !addedFullModels.has(`${providerStorageAlias}/${mm.id}`) && !hardcodedIds.has(mm.id)
          );
          if (notAdded.length === 0) return null;
          return (
            <div className="col-span-full mt-2">
              <p className="text-xs text-text-muted mb-2">Suggested free models (≥200k context):</p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((mm) => (
                  <Button
                    key={mm.id}
                    variant="outline"
                    onClick={async () => {
                      await m.handleAddCustomModel(mm.id, "llm", providerStorageAlias);
                    }}
                    className="text-xs"
                    title={`${mm.name} · ${((mm.contextLength ?? 0) / 1000).toFixed(0)}k ctx`}
                  >
                    <Plus className="size-3" />
                    {mm.id.split("/").pop()}
                  </Button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Disabled models — restorable */}
        {disabledDisplayModels.length > 0 && (
            <div className="col-span-full mt-2">
            <p className="text-xs text-text-muted mb-2">Disabled models ({disabledDisplayModels.length}):</p>
            <div className="flex flex-wrap gap-2">
              {disabledDisplayModels.map((mm) => (
                <Button
                  key={`disabled-${mm.id}`}
                  variant="outline"
                  onClick={() => m.handleEnableModel(mm.id)}
                  className="border-dashed text-xs"
                  title="Restore model"
                >
                  <Plus className="size-3" />
                  {mm.id}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Card padding="xs" className="overflow-visible">
        <div className="mb-3 flex min-w-0 flex-col gap-3 border-b border-border-subtle pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold">{"Available Models"}</h2>
              <p className="mt-1 text-sm text-text-muted">Manage the models exposed by this provider.</p>
            </div>
            {m.providerThinkingLevels && (
              <Select value={thinkingMode} onValueChange={(value) => onThinkingModeChange(value ?? "auto")}>
                <SelectTrigger
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  title="Appends (level) suffix to copied model names"
                >
                  <SelectValue placeholder="Thinking: Auto" />
                </SelectTrigger>
                <SelectContent>
                  {m.providerThinkingLevels.map((opt) => (
                    <SelectItem key={opt} value={opt}>{`Thinking: ${opt.charAt(0).toUpperCase() + opt.slice(1)}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <div className="flex flex-wrap items-center gap-2" title={translate("Inspect") ?? "Inspect"}>
              <Button
                variant="secondary"
                size="sm"
                onClick={m.handleRefreshModels}
                disabled={m.refreshingModels || !!noModelDiscovery}
                title={noModelDiscovery ? translate("This provider has no models-list endpoint — the catalog above is fixed.") ?? undefined : undefined}
              >
                <RefreshCw className={`size-4 mr-1.5 ${m.refreshingModels ? "animate-spin" : ""}`} />
                {m.refreshingModels ? translate("Refreshing...") : translate("Refresh Models")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={m.handleTestAllModels}
                disabled={!!m.testAllModels?.running}
              >
                <Beaker className={`size-4 mr-1.5 ${m.testAllModels?.running ? "animate-pulse" : ""}`} />
                {m.testAllModels?.running ? translate("Testing...") : translate("Test All Models")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowClearConfirmation(true)}
                disabled={m.clearingModels}
                className="text-red-600 hover:text-red-700 dark:text-red-400"
              >
                <Trash2 className="size-4 mr-1.5" />
                {m.clearingModels ? translate("Clearing...") : translate("Clear All Models")}
              </Button>
            </div>
            {!isCompatible && (() => {
              const allIds = [
                ...m.models,
                ...m.kiloFreeModels.filter((fm) => !m.models.some((mm) => mm.id === fm.id)),
              ].filter((mm) => { const k = getModelKind(mm); return !k || k === "llm"; }).map((mm) => mm.id);
              const activeIds = allIds.filter((id) => !m.disabledModelIds.includes(id));
              if (m.disabledModelIds.length === 0 && activeIds.length === 0) return null;
              return (
                <>
                  <div className="mx-1 hidden h-5 w-px bg-border-subtle sm:block" aria-hidden="true" />
                  <div className="flex gap-2" title={translate("Bulk manage") ?? "Bulk manage"}>
                    {m.disabledModelIds.length > 0 && (
                      <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={m.handleEnableAll}>
                        {translate("Active All")}
                      </Button>
                    )}
                    {activeIds.length > 0 && (
                      <Button variant="secondary" icon={<Ban className="size-4" />} onClick={() => m.handleDisableAll(activeIds)}>
                        {translate("Disable All")}
                      </Button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        {!!m.modelsTestError && (
          <p className="text-xs text-red-500 mb-3 break-words">{m.modelsTestError}</p>
        )}
        {renderModelsSection()}
      </Card>

      {!isCompatible && (
        <AddCustomModelModal
          isOpen={m.showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId: string) => {
            await m.handleAddCustomModel(modelId, "llm", providerStorageAlias);
            m.setShowAddCustomModel(false);
          }}
          onClose={() => m.setShowAddCustomModel(false)}
        />
      )}

      <Modal
        isOpen={showClearConfirmation}
        title={translate("Clear all models") || "Clear all models"}
        onClose={() => setShowClearConfirmation(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            {translate("This removes every custom model and alias for this provider and excludes its current models from chat. Refresh Models will rebuild a clean catalog from the provider.")}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowClearConfirmation(false)} disabled={m.clearingModels}>
              {translate("Cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await m.handleClearProviderModels();
                setShowClearConfirmation(false);
              }}
              disabled={m.clearingModels}
            >
              <Trash2 className="size-4 mr-1.5" />
              {m.clearingModels ? translate("Clearing...") : translate("Clear All Models")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Test All Models diagnostics */}
      <Modal
        isOpen={!!m.testAllModels}
        title={translate("Model Test Diagnostics") || "Model Test Diagnostics"}
        size="full"
        className="max-w-[50rem]"
        onClose={() => { if (!m.testAllModels?.running) m.setTestAllModels(null); }}
      >
        {m.testAllModels && (() => {
          const passed = m.testAllModels.results.filter((r) => r.state === "passed");
          const failed = m.testAllModels.results.filter((r) => r.state === "failed");
          const pending = m.testAllModels.results.filter((r) => r.state === "queued" || r.state === "testing" || r.state === "retrying");
          return (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {m.testAllModels.running && (
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <Loader2 className="size-4 animate-spin" />
                    {translate("Testing...")} ({passed.length + failed.length}/{m.testAllModels.results.length})
                  </span>
                )}
                <span className="text-green-500">{translate("Passed") || "Passed"}: {passed.length}</span>
                <span className="text-red-500">{translate("Failed") || "Failed"}: {failed.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {pending.map((r, index) => (
                  <div key={`pending-${r.modelId}-${index}`} className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                    <div className="flex items-center gap-2">
                      {r.state === "queued" ? <span className="size-2 shrink-0 rounded-full bg-muted-foreground" /> : <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />}
                      <code className="truncate text-xs font-mono">{r.modelId}</code>
                      <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                        {r.state === "queued" ? translate("Queued") || "Queued" : `${r.state === "retrying" ? translate("Retrying") || "Retrying" : translate("Testing...")} ${r.attempts}/3`}
                      </span>
                    </div>
                    {r.error && <p className="mt-1 text-xs text-text-muted break-words">{r.error}</p>}
                  </div>
                ))}
                {failed.map((r, index) => (
                  <div key={`failed-${r.modelId}-${index}`} className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <XIcon className="size-4 shrink-0 text-red-500" />
                      <code className="truncate text-xs font-mono">{r.modelId}</code>
                      {r.attempts > 1 && (
                        <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                          {r.attempts}x {translate("attempts") || "attempts"}
                        </span>
                      )}
                    </div>
                    {r.error && <p className="mt-1 text-xs text-text-muted break-words">{r.error}</p>}
                  </div>
                ))}
                {passed.map((r, index) => (
                  <div key={`passed-${r.modelId}-${index}`} className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2">
                    <Check className="size-4 shrink-0 text-green-500" />
                    <code className="truncate text-xs font-mono">{r.modelId}</code>
                    {typeof r.latencyMs === "number" && (
                      <span className="ml-auto shrink-0 text-[10px] text-text-muted">{r.latencyMs}ms</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </Modal>
    </>
  );
}
