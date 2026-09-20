"use client";

import ModelSelectModal from "@/shared/components/ModelSelectModal";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import type { Connection } from "@/lib/data-access";
import type { SmartModelProfile } from "@/shared/llm-catalog";
import { translate } from "@/i18n/runtime";
import ComplexityRoutingBoard from "./ComplexityRoutingBoard";
import { useSmartCombo } from "./useSmartCombo";
import { ComboHeader } from "./ComboHeader";
import { InferenceCard } from "./InferenceCard";
import { PrioritiesCard } from "./PrioritiesCard";
import { ModelInventoryCard } from "./ModelInventoryCard";
import { PreviewModal } from "./PreviewModal";
import { SaveBar } from "./SaveBar";
import type { ComboData } from "./smartComboHelpers";

export default function SmartComboClient({ initialCombo, activeProviders, modelAliases, initialProfiles }: {
  initialCombo: ComboData;
  activeProviders: Connection[];
  modelAliases: Record<string, string>;
  initialProfiles: SmartModelProfile[];
}) {
  const s = useSmartCombo(initialCombo, initialProfiles);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <ComboHeader name={s.name} onNameChange={s.setName} />

      <InferenceCard
        complexityEnabled={s.config.complexity.enabled}
        onComplexityEnabledChange={(enabled) => s.setConfig((c) => ({ ...c, complexity: { enabled } }))}
        taskEnabled={s.config.task.enabled}
        onTaskEnabledChange={(enabled) => s.setConfig((c) => ({ ...c, task: { ...c.task, enabled } }))}
        classifier={s.config.classifier}
        onClassifierEnabledChange={(enabled) => s.setConfig((c) => ({ ...c, classifier: { ...c.classifier, enabled } }))}
        tunedNote={s.classifierTunedNote}
      />

      <ComplexityRoutingBoard
        overrides={s.config.overrides.general || {}}
        onOverridesChange={(tier, models) => s.setConfig((c) => ({
          ...c, overrides: { ...c.overrides, general: { ...c.overrides.general, [tier]: models } },
        }))}
        enabled={s.config.complexity.enabled}
        profiles={s.profiles}
        activeProviders={activeProviders as unknown as ActiveProvider[]}
        modelAliases={modelAliases}
        onSuggest={s.handleSuggest}
        suggesting={s.suggesting}
      />

      <PrioritiesCard
        globalModels={s.globalModels}
        onRemoveGlobalModel={(model) => s.setGlobalModels(s.globalModels.filter((m) => m !== model))}
        onAddGlobalClick={() => s.setShowGlobalModelSelect(true)}
        activeScopes={s.activeScopes}
        onScopeSelect={s.selectScope}
        selectedNeed={s.selectedNeed}
        onNeedChange={s.setSelectedNeed}
        selectedTier={s.selectedTier}
        onTierChange={s.setSelectedTier}
        currentModels={s.currentModels}
        onRemoveModel={(model) => s.patchModels(s.currentModels.filter((m) => m !== model))}
        onAddClick={() => s.setShowModelSelect(true)}
        needOptions={s.NEED_OPTIONS}
        needLabels={s.NEED_LABELS}
        tierLabels={s.TIER_LABELS}
        tierOptions={s.tierOptions}
      />

      <ModelInventoryCard
        profiles={s.profiles}
        profileSummary={s.profileSummary}
        tierLabels={s.TIER_LABELS}
        onRefresh={s.handleRefresh}
        loadingProfiles={s.loadingProfiles}
      />

      <SaveBar dirty={s.isDirty} saving={s.saving} onSave={s.handleSave} />

      {s.showModelSelect && (
        <ModelSelectModal
          isOpen={s.showModelSelect}
          onClose={() => s.setShowModelSelect(false)}
          onSelect={(model) => { if (!s.currentModels.includes(model.value)) s.patchModels([...s.currentModels, model.value]); }}
          onDeselect={(model) => s.patchModels(s.currentModels.filter((m) => m !== model.value))}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          modelAliases={modelAliases}
          title={`${s.NEED_LABELS[s.selectedNeed]} / ${s.TIER_LABELS[s.selectedTier]}`}
          addedModelValues={s.currentModels}
          closeOnSelect={false}
        />
      )}

      {s.showGlobalModelSelect && (
        <ModelSelectModal
          isOpen={s.showGlobalModelSelect}
          onClose={() => s.setShowGlobalModelSelect(false)}
          onSelect={(model) => { if (!s.globalModels.includes(model.value)) s.setGlobalModels([...s.globalModels, model.value]); }}
          onDeselect={(model) => s.setGlobalModels(s.globalModels.filter((m) => m !== model.value))}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          modelAliases={modelAliases}
          title={translate("Always considered") || "Always considered"}
          addedModelValues={s.globalModels}
          closeOnSelect={false}
        />
      )}

      <PreviewModal
        preview={s.preview}
        cappedPreviewProfiles={s.cappedPreviewProfiles}
        tierLabels={s.TIER_LABELS}
        onConfirm={s.handleConfirmProfiles}
        confirming={s.confirming}
        onClose={() => s.setPreview(null)}
        preset={s.suggestionPreset}
        onPresetChange={s.setSuggestionPreset}
        latencies={s.modelTestLatencies}
      />
    </div>
  );
}
