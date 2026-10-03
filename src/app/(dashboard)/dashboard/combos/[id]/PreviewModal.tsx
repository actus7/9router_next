"use client";

import { Check, Gauge, Sparkles, Trophy } from "lucide-react";
import Modal from "@/shared/components/Modal";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { ROUTING_TIERS, type AaModelMetrics, type RoutingTierOrDefault, type SmartModelProfile } from "@/shared/llm-catalog";
import { MAX_SUGGESTIONS_PER_TIER, type ModelLatencyMap, type SuggestionPreset, type SuggestionPreview } from "./smartComboHelpers";

type AaMeta = NonNullable<SuggestionPreview["aaMeta"]>;

/** Whole scores as integers, fractional ones capped at one decimal. */
function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** USD per 1M tokens: $0.86, $12.50 — 2-3 significant digits, never noise. */
function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 3 : 2)}`;
}

/** "3 h ago" / "2 d ago"; minutes only for very recent syncs. */
function relativeTimeFrom(iso: string): string {
  const parsed = Date.parse(iso);
  const elapsedMs = Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 60) return `${minutes} ${translate("min ago") || "min ago"}`;
  const hours = Math.floor(elapsedMs / 3600000);
  if (hours < 24) return `${hours} ${translate("h ago") || "h ago"}`;
  return `${Math.floor(hours / 24)} ${translate("d ago") || "d ago"}`;
}

/** Compact AA metric chips; every null field is simply left out. */
function aaMetricChips(aa: AaModelMetrics): string[] {
  const chips: string[] = [];
  if (aa.intelligence !== null) chips.push(`${translate("intel") || "intel"} ${fmtScore(aa.intelligence)}`);
  if (aa.coding !== null) chips.push(`${translate("code") || "code"} ${fmtScore(aa.coding)}`);
  if (aa.agentic !== null) chips.push(`${translate("agentic") || "agentic"} ${fmtScore(aa.agentic)}`);
  const prices: string[] = [];
  if (aa.inputUsdPer1M !== null) prices.push(fmtUsd(aa.inputUsdPer1M));
  if (aa.outputUsdPer1M !== null) prices.push(fmtUsd(aa.outputUsdPer1M));
  if (prices.length > 0) chips.push(`${prices.join("/")} /1M`);
  if (aa.outputTokensPerSecond !== null) chips.push(`${Math.round(aa.outputTokensPerSecond)} ${translate("tok/s") || "tok/s"}`);
  if (aa.ttftSeconds !== null) chips.push(`${translate("TTFT") || "TTFT"} ${aa.ttftSeconds.toFixed(1)}s`);
  return chips;
}

function AaSyncStatus({ aaMeta }: { aaMeta: AaMeta }) {
  return (
    <p className="mt-1 text-xs text-text-muted">
      <span className="font-medium text-text-main">{translate("Data:") || "Data:"}</span>{" "}
      <a
        href="https://artificialanalysis.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2"
      >
        Artificial Analysis
      </a>
      {" · "}
      {aaMeta.indexVersion !== null && <>{translate("index") || "index"} v{aaMeta.indexVersion.toFixed(1)} · </>}
      {aaMeta.matchedCount}/{aaMeta.modelCount} {translate("models") || "models"} · {translate("updated") || "updated"} {relativeTimeFrom(aaMeta.fetchedAt)}
    </p>
  );
}

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
  const testedCount = cappedPreviewProfiles.filter((profile) => typeof latencies[profile.modelKey.toLowerCase()]?.latencyMs === "number").length;
  // "Fastest" ordena por latencia medida em teste de modelo, guardada no
  // navegador. Sem nenhuma medicao ele cai para a velocidade estimada, ou seja,
  // promete um criterio que nao tem dado para aplicar — melhor nao oferecer.
  const presetTabs: Array<{ value: SuggestionPreset; label: string; description: string; icon: typeof Sparkles }> = [
    { value: "balanced", label: translate("Balanced") || "Balanced", description: translate("AI recommendation, balanced across the four levels") || "AI recommendation, balanced across the four levels", icon: Sparkles },
    ...(testedCount > 0
      ? [{ value: "performance" as const, label: translate("Fastest") || "Fastest", description: translate("Real test latency first; estimated speed fills gaps") || "Real test latency first; estimated speed fills gaps", icon: Gauge }]
      : []),
    { value: "quality", label: translate("Highest quality") || "Highest quality", description: translate("Highest assessed quality in each complexity level") || "Highest assessed quality in each complexity level", icon: Trophy },
  ];
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
            {preview.aaMeta && <AaSyncStatus aaMeta={preview.aaMeta} />}
            {preview.truncated && <p className="mt-1 text-warning">{translate("There were more models than this round's limit; the rest were not reassessed now.")}</p>}
          </div>
          <div className="flex flex-col gap-2" role="tablist" aria-label={translate("Suggestion presets") || "Suggestion presets"}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
            {preset === "performance" && <p className="text-xs text-text-muted">{testedCount} {translate("suggested models have measured test latency.")}</p>}
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
                    ) : tierProfiles.map((profile) => {
                      const chips = profile.aa ? aaMetricChips(profile.aa) : [];
                      return (
                        <div key={profile.modelKey} className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/60 px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-main" title={profile.modelKey}>{profile.displayName || profile.modelKey}</span>
                            <span className="shrink-0 text-[11px] text-text-muted">{preset === "performance" && typeof latencies[profile.modelKey.toLowerCase()]?.latencyMs === "number" ? `${latencies[profile.modelKey.toLowerCase()].latencyMs}ms` : `${Math.round(profile.quality * 100)}%`}</span>
                          </div>
                          {chips.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {chips.map((chip) => (
                                <span key={chip} className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{chip}</span>
                              ))}
                            </div>
                          )}
                          {profile.suggestionReason && (
                            <p className="truncate text-[10px] leading-snug text-text-muted" title={profile.suggestionReason}>{profile.suggestionReason}</p>
                          )}
                        </div>
                      );
                    })}
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
