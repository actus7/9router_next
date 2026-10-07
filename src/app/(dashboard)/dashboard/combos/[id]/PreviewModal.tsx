"use client";

import { Check, Gauge, Sparkles, Trophy } from "lucide-react";
import Modal from "@/shared/components/Modal";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { ROUTING_TIERS, type AaModelMetrics, type RoutingTier, type RoutingTierOrDefault, type SmartModelProfile } from "@/shared/llm-catalog";
import { MAX_SUGGESTIONS_PER_TIER, laneValue, type ModelLatencyMap, type SuggestionLanes, type SuggestionPreset, type SuggestionPreview } from "./smartComboHelpers";

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
      {aaMeta.matchedCount} {translate("of your models have AA data") || "of your models have AA data"} ({translate("AA table") || "AA table"}: {aaMeta.modelCount}) · {translate("updated") || "updated"} {relativeTimeFrom(aaMeta.fetchedAt)}
    </p>
  );
}

/** Chat models without AA data: listed so the operator knows which scores are estimates. */
function UnmatchedModels({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <details className="mt-1 text-xs text-text-muted">
      <summary className="cursor-pointer">
        {names.length} {translate("chat models without Artificial Analysis data; their scores are estimated") || "chat models without Artificial Analysis data; their scores are estimated"}
      </summary>
      <p className="mt-1 max-h-24 overflow-y-auto custom-scrollbar leading-relaxed">{names.join(" · ")}</p>
    </details>
  );
}

function LaneCard({ profile, tier, preset, latencies }: {
  profile: SmartModelProfile;
  tier: RoutingTier;
  preset: SuggestionPreset;
  latencies: ModelLatencyMap;
}) {
  const chips = profile.aa ? aaMetricChips(profile.aa) : [];
  const latency = latencies[profile.modelKey.toLowerCase()]?.latencyMs;
  const value = preset === "performance" && typeof latency === "number"
    ? `${latency}ms`
    : `${Math.round(laneValue(profile, tier, preset) * 100)}%`;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/60 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-main" title={profile.modelKey}>{profile.displayName || profile.modelKey}</span>
        <span className="shrink-0 text-[11px] text-text-muted">{value}</span>
      </div>
      <p className="truncate text-[10px] text-text-muted" title={profile.modelKey}>{profile.provider}</p>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span key={chip} className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{chip}</span>
          ))}
        </div>
      ) : profile.scoreSource === "estimated" && (
        <span className="w-fit rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">{translate("estimated") || "estimated"}</span>
      )}
    </div>
  );
}

export function PreviewModal({
  preview, lanes, tierLabels,
  onConfirm, confirming, onClose, preset, onPresetChange, latencies,
}: {
  preview: SuggestionPreview | null;
  lanes: SuggestionLanes | null;
  tierLabels: Record<RoutingTierOrDefault, string>;
  onConfirm: () => void;
  confirming: boolean;
  onClose: () => void;
  preset: SuggestionPreset;
  onPresetChange: (preset: SuggestionPreset) => void;
  latencies: ModelLatencyMap;
}) {
  const onBoard = lanes ? ROUTING_TIERS.flatMap((tier) => lanes[tier]) : [];
  const testedCount = new Set(onBoard.filter((profile) => typeof latencies[profile.modelKey.toLowerCase()]?.latencyMs === "number").map((profile) => profile.modelKey)).size;
  // "Fastest" ordena por latencia medida em teste de modelo, guardada no
  // navegador. Sem nenhuma medicao ele nao tem dado para aplicar — melhor nao
  // oferecer.
  const presetTabs: Array<{ value: SuggestionPreset; label: string; description: string; icon: typeof Sparkles }> = [
    { value: "balanced", label: translate("Balanced") || "Balanced", description: translate("Quality, cost and speed weighed per level, from measured data") || "Quality, cost and speed weighed per level, from measured data", icon: Sparkles },
    ...(testedCount > 0
      ? [{ value: "performance" as const, label: translate("Fastest") || "Fastest", description: translate("Real test latency first; the balanced score fills gaps") || "Real test latency first; the balanced score fills gaps", icon: Gauge }]
      : []),
    { value: "quality", label: translate("Highest quality") || "Highest quality", description: translate("Highest measured quality in each complexity level") || "Highest measured quality in each complexity level", icon: Trophy },
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
      {preview && lanes && (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="rounded-lg bg-muted p-3 text-sm text-text-muted">
            <p>{translate("Lanes ranked from measured benchmarks, price and speed. Older generations give way to newer ones of the same family.") || "Lanes ranked from measured benchmarks, price and speed. Older generations give way to newer ones of the same family."}</p>
            {preview.aaMeta
              ? <AaSyncStatus aaMeta={preview.aaMeta} />
              : <p className="mt-1 text-warning">{translate("Artificial Analysis data is unavailable; every score is estimated.") || "Artificial Analysis data is unavailable; every score is estimated."}</p>}
            <UnmatchedModels names={preview.unmatched} />
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
            {ROUTING_TIERS.map((tier) => (
              <div key={tier} className="min-w-0 rounded-lg border border-border bg-muted/20 p-2">
                <p className="mb-2 truncate text-xs font-semibold text-text-main">{tierLabels[tier]} <span className="font-normal text-text-muted">({lanes[tier].length})</span></p>
                <div className="flex flex-col gap-1.5">
                  {lanes[tier].length === 0
                    ? <p className="text-xs text-text-muted">{translate("No models suggested.")}</p>
                    : lanes[tier].map((profile) => <LaneCard key={profile.modelKey} profile={profile} tier={tier} preset={preset} latencies={latencies} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
