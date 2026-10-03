"use client";

import { Check, Circle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import type { SuggestProgressState } from "./smartComboHelpers";

type PhaseKey = SuggestProgressState["phase"];

const PHASE_ORDER: PhaseKey[] = ["aa-sync", "inventory"];

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
 * Live progress for the "Suggest models with AI" run: the AA sync, then the
 * inventory — scoring itself is instant. The stream is owned by
 * useSmartCombo: this only renders it, and the sole way out is Cancel (or Esc,
 * which is the same abort) — no close X while the analysis is running.
 */
export function ProgressModal({ progress, onCancel }: { progress: SuggestProgressState; onCancel: () => void }) {
  const activeIndex = PHASE_ORDER.indexOf(progress.phase);

  const phaseRow = (key: PhaseKey, label: string, detail: string | null) => {
    const idx = PHASE_ORDER.indexOf(key);
    const state = idx < activeIndex ? "done" : idx === activeIndex ? "active" : "pending";
    return (
      <li className="flex items-start gap-2.5">
        <PhaseIcon state={state} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${state === "pending" ? "text-text-muted" : "text-text-main"}`}>{label}</p>
          {detail && <p className="text-xs text-text-muted">{detail}</p>}
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
          </ol>
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
