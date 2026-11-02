"use client";

import { useId, useState } from "react";
import { BarChart3, ChevronsUpDown, Cpu, FileText, Sparkles, X, type LucideIcon } from "lucide-react";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { InfoButton } from "@/shared/components/InfoButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { SmartRoutingConfig } from "@/shared/llm-catalog";

const AUTO_MODEL = "auto";

interface SettingRowProps {
  icon: LucideIcon;
  /** Tailwind tint for the icon tile: background + text colour. */
  tone: string;
  title: string;
  description: string;
  ariaLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** A setting that only exists while the switch is on, shown right after it. */
  children?: React.ReactNode;
}

// One inline setting: icon, label, "i", switch — all settings share one row.
// The explanation sits behind the "i", outside the <Label> so opening it does
// not toggle the switch.
function SettingRow({ icon: Icon, tone, title, description, ariaLabel, checked, onCheckedChange, children }: SettingRowProps) {
  const id = useId();
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${tone}`} aria-hidden>
        <Icon className="size-4" />
      </span>
      <Label htmlFor={id} className="text-sm font-medium">{title}</Label>
      <InfoButton label={title}><p>{description}</p></InfoButton>
      <Switch id={id} size="sm" aria-label={ariaLabel} checked={checked} onCheckedChange={onCheckedChange} />
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
    <div className="flex items-center gap-1">
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
          className="h-7 w-52 justify-between text-xs font-normal"
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
  extra,
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
  /** Further combo-wide setup that shares the row (fallback, model set). */
  extra?: React.ReactNode;
}) {
  const rows: SettingRowProps[] = [
    {
      icon: BarChart3,
      tone: "bg-info/15 text-info",
      title: translate("Request complexity") || "Request complexity",
      description: translate("Grades each request on the spot and picks the matching tier. Off: everything routes as Standard.") || "",
      ariaLabel: translate("Enable complexity-based routing") || "Enable complexity-based routing",
      checked: complexityEnabled,
      onCheckedChange: onComplexityEnabledChange,
    },
    {
      icon: FileText,
      tone: "bg-primary/15 text-primary",
      title: translate("Request type") || "Request type",
      description: translate("Identifies code, image, search and the like, and prefers models good at it. Off: uses only the endpoint's own type.") || "",
      ariaLabel: translate("Enable task-based routing") || "Enable task-based routing",
      checked: taskEnabled,
      onCheckedChange: onTaskEnabledChange,
    },
    {
      icon: Sparkles,
      tone: "bg-success/15 text-success",
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
    <Card size="sm" className="py-3">
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {translate("What the system decides on its own")}
            <InfoButton label={translate("What the system decides on its own") || "What the system decides on its own"}>
              <p>{translate("Turn one off and the router stops inferring that dimension — it does not become manual, it becomes fixed.")}</p>
            </InfoButton>
          </span>
          {rows.map((row) => <SettingRow key={row.title} {...row} />)}
          {extra ? <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:ml-auto">{extra}</div> : null}
        </div>
        {tunedNote && <p className="text-xs text-text-muted">{tunedNote}</p>}
      </CardContent>
    </Card>
  );
}
