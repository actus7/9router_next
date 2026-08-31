"use client";

import { ModelSelectModal } from "@/shared/components";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import type { Connection } from "@/lib/data-access";
import type { SmartModelProfile } from "@/shared/llm-catalog";
import { translate } from "@/i18n/runtime";
import ComplexityRoutingBoard from "./ComplexityRoutingBoard";
import { useSmartCombo } from "./useSmartCombo";
import { ComboHeader } from "./ComboHeader";
import { NameSettingsCard } from "./NameSettingsCard";
import { GlobalModelsCard } from "./GlobalModelsCard";
import { ClassifierSettingsCard } from "./ClassifierSettingsCard";
import { NeedTierOverridesCard } from "./NeedTierOverridesCard";
import { ModelInventoryCard } from "./ModelInventoryCard";
import { PreviewModal } from "./PreviewModal";
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
      <ComboHeader saving={s.saving} onSave={s.handleSave} />

      <NameSettingsCard
        name={s.name}
        onNameChange={s.setName}
        taskEnabled={s.config.task.enabled}
        onTaskEnabledChange={(enabled) => s.setConfig((c) => ({ ...c, task: { ...c.task, enabled } }))}
      />

      <ComplexityRoutingBoard
        overrides={s.config.overrides.general || {}}
        onOverridesChange={(tier, models) => s.setConfig((c) => ({
          ...c, overrides: { ...c.overrides, general: { ...c.overrides.general, [tier]: models } },
        }))}
        enabled={s.config.complexity.enabled}
        onEnabledChange={(enabled) => s.setConfig((c) => ({ ...c, complexity: { enabled } }))}
        profiles={s.profiles}
        activeProviders={activeProviders as unknown as ActiveProvider[]}
        modelAliases={modelAliases}
        onSuggest={s.handleSuggest}
        suggesting={s.suggesting}
      />

      <GlobalModelsCard
        globalModels={s.globalModels}
        onRemoveModel={(model) => s.setGlobalModels(s.globalModels.filter((m) => m !== model))}
        onAddClick={() => s.setShowGlobalModelSelect(true)}
      />

      <ClassifierSettingsCard
        classifier={s.config.classifier}
        onClassifierChange={(update) => s.setConfig((c) => ({ ...c, classifier: { ...c.classifier, ...update } }))}
      />

      <NeedTierOverridesCard
        selectedNeed={s.selectedNeed}
        onNeedChange={(need) => { s.setSelectedNeed(need); if (need === "general") s.setSelectedTier("default"); }}
        selectedTier={s.selectedTier}
        onTierChange={s.setSelectedTier}
        currentModels={s.currentModels}
        onRemoveModel={(model) => s.patchModels(s.currentModels.filter((m) => m !== model))}
        onAddClick={() => s.setShowModelSelect(true)}
        needOptions={s.NEED_OPTIONS}
        needLabels={s.NEED_LABELS}
        tierLabels={s.TIER_LABELS}
        tierOptionsForNeed={s.tierOptionsForNeed}
      />

      <ModelInventoryCard
        profiles={s.profiles}
        profileSummary={s.profileSummary}
        tierLabels={s.TIER_LABELS}
        onRefresh={s.handleRefresh}
        loadingProfiles={s.loadingProfiles}
        onSuggest={s.handleSuggest}
        suggesting={s.suggesting}
      />

      {s.showModelSelect && (
        <ModelSelectModal
          isOpen={s.showModelSelect}
          onClose={() => s.setShowModelSelect(false)}
          onSelect={(model) => { if (!s.currentModels.includes(model.value)) s.patchModels([...s.currentModels, model.value]); }}
          onDeselect={(model) => s.patchModels(s.currentModels.filter((m) => m !== model.value))}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          modelAliases={modelAliases}
          title={`Override: ${s.NEED_LABELS[s.selectedNeed]} / ${s.TIER_LABELS[s.selectedTier]}`}
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
          title={translate("Add global override") || "Add global override"}
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
      />
    </div>
  );
}
