"use client";

import { Check, Circle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import type { SuggestProgressState } from "./smartComboHelpers";

type PhaseKey = SuggestProgressState["phase"];

const PHASE_ORDER: PhaseKey[] = ["aa-sync", "inventory", "cache", "web-research", "batch"];

function PhaseIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Check aria-hidden="true" className="size-3" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
      </span>
    );
  }
  return <Circle aria-hidden="true" className="size-5 shrink-0 text-text-muted/40" />;
}

/**
 * Live progress for the "Suggest models with AI" run. The stream is owned by
 * useSmartCombo: this only renders it, and the sole way out is Cancel (or Esc,
 * which is the same abort) — no close X while the analysis is running.
 */
export function ProgressModal({ progress, onCancel }: { progress: SuggestProgressState; onCancel: () => void }) {
  const activeIndex = PHASE_ORDER.indexOf(progress.phase);
  const batch = progress.batch;
  const pct = batch ? Math.min(100, Math.round((batch.index / Math.max(1, batch.total)) * 100)) : 0;

  const phaseRow = (key: PhaseKey, label: string, detail: string | null) => {
    const idx = PHASE_ORDER.indexOf(key);
    const state = idx < activeIndex ? "done" : idx === activeIndex ? "active" : "pending";
    return (
      <li className="flex items-start gap-2.5">
        <PhaseIcon state={state} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${state === "pending" ? "text-text-muted" : "text-text-main"}`}>{label}</p>
          {detail && <p className="text-xs text-text-muted">{detail}</p>}
          {key === "batch" && batch && (
            <div className="mt-1.5">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={batch.total}
                aria-valuenow={batch.index}
                aria-label={translate("Batch progress") || "Batch progress"}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-text-muted">{pct}%</p>
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      disablePointerDismissal
    >
      <DialogContent className="max-w-md gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="border-b border-border p-4">
          <DialogTitle>{translate("Suggest models with AI") || "Suggest models with AI"}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 overflow-x-hidden overflow-y-auto max-h-[calc(85vh-100px)] p-4 custom-scrollbar">
          <ol className="flex flex-col gap-3" aria-live="polite">
            {phaseRow("aa-sync", translate("Sync Artificial Analysis") || "Sync Artificial Analysis", null)}
            {phaseRow(
              "inventory",
              translate("Model inventory") || "Model inventory",
              progress.inventory
                ? `${progress.inventory.llmEligible}/${progress.inventory.total} ${translate("LLM-eligible") || "LLM-eligible"}`
                : null,
            )}
            {phaseRow(
              "cache",
              translate("Analysis cache") || "Analysis cache",
              progress.cache
                ? `${progress.cache.cached} ${translate("reused") || "reused"} · ${progress.cache.toAnalyze} ${translate("to analyze") || "to analyze"}`
                : null,
            )}
            {phaseRow(
              "web-research",
              translate("Web research") || "Web research",
              progress.webResearchUsed === null
                ? null
                : progress.webResearchUsed
                  ? translate("used") || "used"
                  : translate("not used") || "not used",
            )}
            {phaseRow(
              "batch",
              translate("Batch analysis") || "Batch analysis",
              batch
                ? `${translate("Analyzing batch") || "Analyzing batch"} ${batch.index} ${translate("of") || "of"} ${batch.total}`
                : null,
            )}
          </ol>

          {(progress.cache || progress.analyzed.length > 0) && (
            <div className="mt-4">
              <p className="text-xs font-medium text-text-main">
                {progress.analyzed.length} {translate("models analyzed") || "models analyzed"}
                {progress.cache ? <> · {progress.cache.cached} {translate("from cache") || "from cache"}</> : null}
              </p>
              {progress.analyzed.length > 0 && (
                <div className="mt-2 max-h-36 overflow-y-auto custom-scrollbar rounded-lg border border-border-subtle bg-muted/30 p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {progress.analyzed.map((model) => (
                      <span
                        key={model}
                        title={model}
                        className="max-w-full truncate rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted"
                      >
                        {model}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {progress.cache && progress.cache.skippedByLimit > 0 && (
                <p className="mt-1.5 text-xs text-text-muted">
                  {progress.cache.skippedByLimit} {translate("models outside this run's limit") || "models outside this run's limit"}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" fullWidth onClick={onCancel}>
            {translate("Cancel") || "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
