"use client";

import { Card } from "@/shared/components";
import { Input as RawInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { SmartRoutingConfig } from "@/shared/llm-catalog";

export function ClassifierSettingsCard({
  classifier, onClassifierChange,
}: {
  classifier: SmartRoutingConfig["classifier"];
  onClassifierChange: (update: Partial<SmartRoutingConfig["classifier"]>) => void;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-text-main">{translate("AI tiebreaker")}</h2>
          <p className="mt-1 text-sm text-text-muted">{translate("When the system is unsure which tier to use (simple, standard, complex or reasoning), it asks an AI model to decide quickly. If it takes too long, it falls back to the automatic decision.")}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Label className="flex min-h-11 items-center justify-between rounded-lg bg-muted px-3 text-sm">
            {translate("Enabled")}
            <Switch aria-label={translate("Enable AI tiebreaker") || "Enable AI tiebreaker"} checked={classifier.enabled} onCheckedChange={(enabled) => onClassifierChange({ enabled })} />
          </Label>
          <div>
            <Label className="mb-1.5 block text-xs text-text-muted">{translate("Confidence threshold (0 to 1)")}</Label>
            <RawInput type="number" min="0" max="1" step="0.05" value={classifier.confidenceThreshold} onChange={(event) => onClassifierChange({ confidenceThreshold: Number(event.target.value) })} />
            <p className="mt-1 text-[11px] text-text-muted">{translate("Below this threshold, asks AI for help instead of deciding on its own")}</p>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs text-text-muted">{translate("Maximum wait time")} (ms)</Label>
            <RawInput type="number" min="250" max="30000" step="250" value={classifier.timeoutMs} onChange={(event) => onClassifierChange({ timeoutMs: Number(event.target.value) })} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs text-text-muted">{translate("Decision model")}</Label>
            <RawInput value={classifier.model} placeholder={translate("auto") || "auto"} onChange={(event) => onClassifierChange({ model: event.target.value || "auto" })} />
          </div>
        </div>
      </div>
    </Card>
  );
}
