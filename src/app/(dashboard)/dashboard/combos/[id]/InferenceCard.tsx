"use client";

import { Card } from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { SmartRoutingConfig } from "@/shared/llm-catalog";

interface ToggleProps {
  title: string;
  description: string;
  ariaLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function InferenceToggle({ title, description, ariaLabel, checked, onCheckedChange }: ToggleProps) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg bg-muted px-3 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-main">{title}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{description}</span>
      </span>
      <Switch aria-label={ariaLabel} checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

/**
 * The three axes of what the router works out on its own.
 *
 * They were spread across three cards — complexity in the routing board, task
 * detection in the name card, the AI tiebreaker in a card of its own next to
 * three numeric fields. The fields are gone: `confidenceThreshold`, `timeoutMs`
 * and `model` are tuning nobody calibrates without telemetry, they are clamped
 * server-side against a default, and `task.confidenceThreshold` was already
 * hidden the same way. They stay editable through `PUT /api/combos`.
 */
export function InferenceCard({
  complexityEnabled, onComplexityEnabledChange,
  taskEnabled, onTaskEnabledChange,
  classifier, onClassifierEnabledChange,
  tunedNote,
}: {
  complexityEnabled: boolean;
  onComplexityEnabledChange: (enabled: boolean) => void;
  taskEnabled: boolean;
  onTaskEnabledChange: (enabled: boolean) => void;
  classifier: SmartRoutingConfig["classifier"];
  onClassifierEnabledChange: (enabled: boolean) => void;
  tunedNote: string | null;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-main">{translate("What the system decides on its own")}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {translate("Turn one off and the router stops inferring that dimension — it does not become manual, it becomes fixed.")}
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <InferenceToggle
            title={translate("Request complexity") || "Request complexity"}
            description={translate("Grades each request on the spot and picks the matching tier. Off: everything routes as Standard.") || ""}
            ariaLabel={translate("Enable complexity-based routing") || "Enable complexity-based routing"}
            checked={complexityEnabled}
            onCheckedChange={onComplexityEnabledChange}
          />
          <InferenceToggle
            title={translate("Request type") || "Request type"}
            description={translate("Identifies code, image, search and the like, and prefers models good at it. Off: uses only the endpoint's own type.") || ""}
            ariaLabel={translate("Enable task-based routing") || "Enable task-based routing"}
            checked={taskEnabled}
            onCheckedChange={onTaskEnabledChange}
          />
          <InferenceToggle
            title={translate("AI tiebreaker") || "AI tiebreaker"}
            description={translate("When the local score is unsure, asks a model to break the tie. Off: it always decides on its own.") || ""}
            ariaLabel={translate("Enable AI tiebreaker") || "Enable AI tiebreaker"}
            checked={classifier.enabled}
            onCheckedChange={onClassifierEnabledChange}
          />
        </div>

        {tunedNote && <p className="text-xs text-text-muted">{tunedNote}</p>}
      </div>
    </Card>
  );
}
