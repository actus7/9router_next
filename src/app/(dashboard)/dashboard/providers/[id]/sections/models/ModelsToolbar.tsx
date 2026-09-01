"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { translate } from "@/i18n/runtime";
import { getModelKind } from "@/shared/constants/models";
import { Ban, Beaker, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { UseProviderModelsReturn } from "../../hooks/useProviderModels";
import type { LiveModel } from "../../types";

interface ModelsToolbarProps {
  providerId: string;
  isCompatible: boolean;
  thinkingMode: string;
  onThinkingModeChange: (mode: string) => void;
  noModelDiscovery?: boolean;
  modelsHook: UseProviderModelsReturn;
  onShowClearConfirmation: () => void;
  models: LiveModel[];
  kiloFreeModels: LiveModel[];
}

export default function ModelsToolbar({
  providerId: _providerId,
  isCompatible,
  thinkingMode,
  onThinkingModeChange,
  noModelDiscovery,
  modelsHook: m,
  onShowClearConfirmation,
  models,
  kiloFreeModels,
}: ModelsToolbarProps) {
  return (
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
            {m.testAllModels?.running ? translate("Testing...") : translate("Test Model Sample")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onShowClearConfirmation}
            disabled={m.clearingModels}
            className="text-red-600 hover:text-red-700 dark:text-red-400"
          >
            <Trash2 className="size-4 mr-1.5" />
            {m.clearingModels ? translate("Clearing...") : translate("Clear All Models")}
          </Button>
        </div>
        {!isCompatible && (() => {
          const allIds = [
            ...models,
            ...kiloFreeModels.filter((fm) => !models.some((mm) => mm.id === fm.id)),
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
  );
}
