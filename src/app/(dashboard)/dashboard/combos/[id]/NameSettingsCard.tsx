"use client";

import { Card, Input } from "@/shared/components";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";

export function NameSettingsCard({
  name, onNameChange, taskEnabled, onTaskEnabledChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  taskEnabled: boolean;
  onTaskEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <Card>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div>
          <Input label={translate("Combo Name") || "Combo Name"} value={name} onChange={(event) => onNameChange(event.target.value)} />
          <p className="mt-2 text-xs text-text-muted">{translate("Use this name in the")} <code className="font-mono">model</code> {translate("field. The")} <code className="font-mono">x-router-tier</code> {translate("header can pin a tier per request.")}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <Label className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-muted px-3">
            <span><span className="block text-sm font-medium">{translate("Detect request topic")}</span><span className="block text-xs text-text-muted">{translate("Beyond complexity, tries to identify if it is code, image, search, etc. and prioritizes models good at it")}</span></span>
            <Switch aria-label={translate("Enable task-based routing") || "Enable task-based routing"} checked={taskEnabled} onCheckedChange={onTaskEnabledChange} />
          </Label>
        </div>
      </div>
    </Card>
  );
}
