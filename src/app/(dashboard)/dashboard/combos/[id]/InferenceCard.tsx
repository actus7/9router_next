"use client";

import { useState } from "react";
import { Cpu, X } from "lucide-react";
import Card from "@/shared/components/Card";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { InfoButton } from "@/shared/components/InfoButton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { SmartRoutingConfig } from "@/shared/llm-catalog";

const AUTO_MODEL = "auto";

interface ToggleProps {
  title: string;
  description: string;
  ariaLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: React.ReactNode;
}

// The description lives behind the "i": three paragraphs of explanation beside
// three switches buried the switches. Not a <label>, so the "i" does not toggle.
function InferenceToggle({ title, description, ariaLabel, checked, onCheckedChange, children }: ToggleProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-muted px-3 py-1.5">
      <span className="flex min-w-0 items-center gap-1 text-sm font-medium text-text-main">
        {title}
        <InfoButton label={title}><p>{description}</p></InfoButton>
      </span>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <Switch aria-label={ariaLabel} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  );
}

/** Which model breaks ties: "Auto" (the router's cheap default) or a model the user picks. */
function TiebreakerModelPicker({ model, onChange, activeProviders, modelAliases }: {
  model: string;
  onChange: (model: string) => void;
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const isAuto = !model || model === AUTO_MODEL;
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 max-w-40 border-dashed px-2 font-mono text-xs"
        aria-label={translate("Tiebreaker model") || "Tiebreaker model"}
      >
        <Cpu data-icon="inline-start" />
        <span className="truncate">{isAuto ? (translate("Auto") || "Auto") : model}</span>
      </Button>
      {!isAuto && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange(AUTO_MODEL)}
          className="text-destructive"
          aria-label={translate("Reset tiebreaker model to Auto") || "Reset tiebreaker model to Auto"}
        >
          <X />
        </Button>
      )}
      {open && (
        <ModelSelectModal
          isOpen={open}
          onClose={() => setOpen(false)}
          onSelect={(picked: { value: string }) => { onChange(picked?.value || AUTO_MODEL); setOpen(false); }}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={translate("Select tiebreaker model") || "Select tiebreaker model"}
          addedModelValues={isAuto ? [] : [model]}
          closeOnSelect={true}
          includeSystemOne
          systemOneNote={translate("A System One model classifies the request directly, with calibrated confidence. When it is not sure, the automatic LLM tiebreaker takes over.") || undefined}
        />
      )}
    </div>
  );
}

/**
 * The three axes of what the router works out on its own.
 *
 * They were spread across three cards — complexity in the routing board, task
 * detection in the name card, the AI tiebreaker in a card of its own next to
 * three numeric fields. The numeric fields stay off the screen
 * (`confidenceThreshold`, `timeoutMs`: tuning nobody calibrates without
 * telemetry, clamped server-side; editable through `PUT /api/combos`). The
 * tiebreaker *model* is back: which model judges your prompts is a choice,
 * not tuning.
 */
export function InferenceCard({
  complexityEnabled, onComplexityEnabledChange,
  taskEnabled, onTaskEnabledChange,
  classifier, onClassifierEnabledChange, onClassifierModelChange,
  activeProviders, modelAliases,
  tunedNote,
}: {
  complexityEnabled: boolean;
  onComplexityEnabledChange: (enabled: boolean) => void;
  taskEnabled: boolean;
  onTaskEnabledChange: (enabled: boolean) => void;
  classifier: SmartRoutingConfig["classifier"];
  onClassifierEnabledChange: (enabled: boolean) => void;
  onClassifierModelChange: (model: string) => void;
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
  tunedNote: string | null;
}) {
  return (
    <Card padding="xs">
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text-main">
          {translate("What the system decides on its own")}
          <InfoButton label={translate("What the system decides on its own") || "What the system decides on its own"}>
            <p>{translate("Turn one off and the router stops inferring that dimension — it does not become manual, it becomes fixed.")}</p>
          </InfoButton>
        </h2>

        <div className="grid gap-2 lg:grid-cols-3">
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
          >
            {classifier.enabled && (
              <TiebreakerModelPicker
                model={classifier.model}
                onChange={onClassifierModelChange}
                activeProviders={activeProviders}
                modelAliases={modelAliases}
              />
            )}
          </InferenceToggle>
        </div>

        {tunedNote && <p className="text-xs text-text-muted">{tunedNote}</p>}
      </div>
    </Card>
  );
}
