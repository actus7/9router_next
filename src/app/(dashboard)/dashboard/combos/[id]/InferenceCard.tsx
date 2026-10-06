"use client";

import { Fragment, useId, useState } from "react";
import { ChevronsUpDown, Cpu, X } from "lucide-react";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { InfoButton } from "@/shared/components/InfoButton";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { SmartRoutingConfig } from "@/shared/llm-catalog";

const AUTO_MODEL = "auto";

interface SettingRowProps {
  title: string;
  description: string;
  ariaLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** A setting that only exists while the switch is on, shown indented beneath it. */
  children?: React.ReactNode;
}

// shadcn settings row: label on the left, control on the right, every row's
// control in the same column. The explanation sits behind the "i", outside the
// <Label> so opening it does not toggle the switch.
function SettingRow({ title, description, ariaLabel, checked, onCheckedChange, children }: SettingRowProps) {
  const id = useId();
  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label htmlFor={id} className="text-sm font-medium">{title}</Label>
          <InfoButton label={title}><p>{description}</p></InfoButton>
        </div>
        <Switch id={id} aria-label={ariaLabel} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      {children}
    </div>
  );
}

/** Which model breaks ties: "Auto" (the router's cheap default) or a model the user picks. */
function TiebreakerModelRow({ model, onChange, activeProviders, modelAliases }: {
  model: string;
  onChange: (model: string) => void;
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const isAuto = !model || model === AUTO_MODEL;
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 pb-1 pl-4">
      <span className="text-sm text-text-muted">{translate("Tiebreaker model") || "Tiebreaker model"}</span>
      <div className="flex items-center gap-1">
        {!isAuto && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(AUTO_MODEL)}
            aria-label={translate("Reset tiebreaker model to Auto") || "Reset tiebreaker model to Auto"}
          >
            <X />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="w-56 justify-between font-normal"
          aria-label={translate("Tiebreaker model") || "Tiebreaker model"}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Cpu className="size-4 shrink-0 text-text-muted" aria-hidden />
            <span className="truncate">{isAuto ? (translate("Auto") || "Auto") : model}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </div>
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
  const rows: SettingRowProps[] = [
    {
      title: translate("Request complexity") || "Request complexity",
      description: translate("Grades each request on the spot and picks the matching tier. Off: everything routes as Standard.") || "",
      ariaLabel: translate("Enable complexity-based routing") || "Enable complexity-based routing",
      checked: complexityEnabled,
      onCheckedChange: onComplexityEnabledChange,
    },
    {
      title: translate("Request type") || "Request type",
      description: translate("Identifies code, image, search and the like, and prefers models good at it. Off: uses only the endpoint's own type.") || "",
      ariaLabel: translate("Enable task-based routing") || "Enable task-based routing",
      checked: taskEnabled,
      onCheckedChange: onTaskEnabledChange,
    },
    {
      title: translate("AI tiebreaker") || "AI tiebreaker",
      description: translate("When the local score is unsure, asks a model to break the tie. Off: it always decides on its own.") || "",
      ariaLabel: translate("Enable AI tiebreaker") || "Enable AI tiebreaker",
      checked: classifier.enabled,
      onCheckedChange: onClassifierEnabledChange,
      children: classifier.enabled ? (
        <TiebreakerModelRow
          model={classifier.model}
          onChange={onClassifierModelChange}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
        />
      ) : undefined,
    },
  ];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{translate("What the system decides on its own")}</CardTitle>
        <CardAction>
          <InfoButton label={translate("What the system decides on its own") || "What the system decides on its own"}>
            <p>{translate("Turn one off and the router stops inferring that dimension — it does not become manual, it becomes fixed.")}</p>
          </InfoButton>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col">
        {rows.map((row, index) => (
          <Fragment key={row.title}>
            {index > 0 && <Separator />}
            <SettingRow {...row} />
          </Fragment>
        ))}
        {tunedNote && <p className="pt-2 text-xs text-text-muted">{tunedNote}</p>}
      </CardContent>
    </Card>
  );
}
