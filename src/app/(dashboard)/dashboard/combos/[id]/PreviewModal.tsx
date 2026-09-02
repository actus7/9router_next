"use client";

import { Check, Gauge, Sparkles, Trophy } from "lucide-react";
import { Modal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { ROUTING_TIERS, type RoutingTierOrDefault, type SmartModelProfile } from "@/shared/llm-catalog";
import { MAX_SUGGESTIONS_PER_TIER, type ModelLatencyMap, type SuggestionPreset, type SuggestionPreview } from "./smartComboHelpers";

export function PreviewModal({
  preview, cappedPreviewProfiles, tierLabels,
  onConfirm, confirming, onClose, preset, onPresetChange, latencies,
}: {
  preview: SuggestionPreview | null;
  cappedPreviewProfiles: SmartModelProfile[];
  tierLabels: Record<RoutingTierOrDefault, string>;
  onConfirm: () => void;
  confirming: boolean;
  onClose: () => void;
  preset: SuggestionPreset;
  onPresetChange: (preset: SuggestionPreset) => void;
  latencies: ModelLatencyMap;
}) {
  const presetTabs: Array<{ value: SuggestionPreset; label: string; description: string; icon: typeof Sparkles }> = [
    { value: "balanced", label: translate("Balanced") || "Balanced", description: translate("AI recommendation, balanced across the four levels") || "AI recommendation, balanced across the four levels", icon: Sparkles },
    { value: "performance", label: translate("Fastest") || "Fastest", description: translate("Real test latency first; estimated speed fills gaps") || "Real test latency first; estimated speed fills gaps", icon: Gauge },
    { value: "quality", label: translate("Highest quality") || "Highest quality", description: translate("Highest assessed quality in each complexity level") || "Highest assessed quality in each complexity level", icon: Trophy },
  ];
  const testedCount = cappedPreviewProfiles.filter((profile) => typeof latencies[profile.modelKey.toLowerCase()]?.latencyMs === "number").length;
  return (
    <Modal
      isOpen={!!preview}
      onClose={onClose}
      title={translate("AI-assessed models") || "AI-assessed models"}
      size="full"
      footer={
        <>
          <Button variant="ghost" fullWidth onClick={onClose}>{translate("Cancel")}</Button>
          <Button fullWidth onClick={onConfirm} loading={confirming}><Check data-icon="inline-start" /> {translate("Apply to routing board")}</Button>
        </>
      }
    >
      {preview && (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="rounded-lg bg-muted p-3 text-sm text-text-muted">
            <p className="truncate"><span className="font-medium text-text-main">{translate("Assessed by:")}</span> {preview.classifierModel}</p>
            <p className="mt-1"><span className="font-medium text-text-main">{translate("Web research:")}</span> {preview.webResearchUsed ? `${translate("yes, via")} ${preview.researchProvider}` : translate("unavailable; used a conservative estimate")}</p>
            {preview.truncated && <p className="mt-1 text-warning">{translate("There were more models than this round's limit; the rest were not reassessed now.")}</p>}
          </div>
          <div className="flex flex-col gap-2" role="tablist" aria-label={translate("Suggestion presets") || "Suggestion presets"}>
            <div className="grid gap-2 sm:grid-cols-3">
              {presetTabs.map((tab) => {
                const Icon = tab.icon;
                const active = preset === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onPresetChange(tab.value)}
                    className={`min-h-11 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? "border-primary bg-primary/10 text-text-main" : "border-border bg-surface text-text-muted hover:bg-muted"}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" /> {tab.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug">{tab.description}</span>
                  </button>
                );
              })}
            </div>
            {preset === "performance" && <p className="text-xs text-text-muted">{testedCount > 0 ? `${testedCount} ${translate("suggested models have measured test latency.") || "suggested models have measured test latency."}` : translate("No measured test latency yet; this preset is using estimated speed.") || "No measured test latency yet; this preset is using estimated speed."}</p>}
          </div>
          <p className="text-xs text-text-muted">{translate("Organized by complexity level")} ({translate("up to")} {MAX_SUGGESTIONS_PER_TIER} {translate("models per tier")}). {translate("On confirm, this list replaces what is in the \"Default routing\" board above.")}</p>
          <div className="grid max-h-[55vh] gap-3 overflow-y-auto custom-scrollbar sm:grid-cols-2 lg:grid-cols-4">
            {ROUTING_TIERS.map((tier) => {
              const tierProfiles = cappedPreviewProfiles.filter((profile) => profile.recommendedTier === tier);
              return (
                <div key={tier} className="min-w-0 rounded-lg border border-border bg-muted/20 p-2">
                  <p className="mb-2 truncate text-xs font-semibold text-text-main">{tierLabels[tier]} <span className="font-normal text-text-muted">({tierProfiles.length})</span></p>
                  <div className="flex flex-col gap-1.5">
                    {tierProfiles.length === 0 ? (
                      <p className="text-xs text-text-muted">{translate("No models suggested.")}</p>
                    ) : tierProfiles.map((profile) => (
                      <div key={profile.modelKey} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-main" title={profile.modelKey}>{profile.displayName || profile.modelKey}</span>
                        <span className="shrink-0 text-[11px] text-text-muted">{preset === "performance" && typeof latencies[profile.modelKey.toLowerCase()]?.latencyMs === "number" ? `${latencies[profile.modelKey.toLowerCase()].latencyMs}ms` : `${Math.round(profile.quality * 100)}%`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
