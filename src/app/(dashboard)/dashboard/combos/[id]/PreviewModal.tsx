"use client";

import { Check } from "lucide-react";
import { Modal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { ROUTING_TIERS, type RoutingTierOrDefault, type SmartModelProfile } from "@/shared/llm-catalog";
import { MAX_SUGGESTIONS_PER_TIER, type SuggestionPreview } from "./smartComboHelpers";

export function PreviewModal({
  preview, cappedPreviewProfiles, tierLabels,
  onConfirm, confirming, onClose,
}: {
  preview: SuggestionPreview | null;
  cappedPreviewProfiles: SmartModelProfile[];
  tierLabels: Record<RoutingTierOrDefault, string>;
  onConfirm: () => void;
  confirming: boolean;
  onClose: () => void;
}) {
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
            {preview.truncated && <p className="mt-1 text-warning-foreground">{translate("There were more models than this round's limit; the rest were not reassessed now.")}</p>}
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
                        <span className="shrink-0 text-[11px] text-text-muted">{Math.round(profile.quality * 100)}%</span>
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
