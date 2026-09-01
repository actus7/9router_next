"use client";

import { useState } from "react";
import { Card, ModelSelectModal, CapacityBadges } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import type { Connection } from "@/lib/data-access";
import type { CapEntry, CapacityAdapterDefinition, ModelCapsGetter } from "./combo-types";
import { CAPACITY_ADAPTER_CAPS, EMPTY_CAP_ENTRY } from "./combo-types";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

export function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }: {
  capacityAdapter: Record<string, CapEntry>;
  onChange: (next: Record<string, CapEntry>) => void;
  activeProviders: Connection[];
  getCaps: ModelCapsGetter;
}) {
  return (
    <section aria-labelledby="capacity-adapters-heading" className="flex flex-col gap-3">
      <div className="min-w-0">
        <h2 id="capacity-adapters-heading" className="text-base font-semibold text-text-main">{translate("Vision & Audio")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{translate("Redirect unsupported image or audio inputs to a compatible fallback model.")}</p>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap key={cap.key} cap={cap} entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY} onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })} activeProviders={activeProviders} getCaps={getCaps} />
        ))}
      </div>
    </section>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }: {
  cap: CapacityAdapterDefinition; entry: CapEntry; onChange: (entry: CapEntry) => void; activeProviders: Connection[]; getCaps: ModelCapsGetter;
}) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;
  const patch = (p: Partial<CapEntry>) => onChange({ ...entry, ...p });
  const handleAdd = (model: { value: string }) => { if (!models.includes(model.value)) patch({ models: [...models, model.value] }); };
  const handleDeselect = (model: { value: string }) => { patch({ models: models.filter((v) => v !== model.value) }); };
  const handleRemove = (index: number) => { patch({ models: models.filter((_, i) => i !== index) }); };
  const handleMove = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models]; [next[index], next[target]] = [next[target], next[index]]; patch({ models: next });
  };
  const Icon = cap.icon;

  return (
    <Card padding="sm" className={cn("group", !enabled && "bg-surface/70")}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-text-main">{cap.label}</h3>
              <p className="mt-0.5 text-xs text-text-muted">{cap.desc}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 lg:w-auto lg:grid-cols-[auto_auto_auto]">
            <Label className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-lg bg-muted px-3 text-xs text-text-muted">
              <span>{translate("Enabled") || "Enabled"}</span>
              <Switch checked={enabled} onCheckedChange={(v: boolean) => patch({ enabled: v })} aria-label={`Enable ${cap.label} adapter`} />
            </Label>
            <Label className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-lg bg-muted px-3 text-xs text-text-muted">
              <span>Round Robin</span>
              <Switch checked={roundRobin} onCheckedChange={(v: boolean) => patch({ roundRobin: v })} disabled={!enabled} aria-label={`Round-robin ${cap.label} adapter`} />
            </Label>
            <Button variant="outline" size="sm" onClick={() => setShowModelSelect(true)} disabled={!enabled} title={`Add ${cap.label} model`} className="col-span-2 min-h-11 lg:col-span-1">
              <Plus data-icon="inline-start" />{translate("Add Model") || "Add Model"}
            </Button>
          </div>
        </div>
        {models.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-text-muted">{translate("No models selected") || "No models selected"}</p>
        ) : (
          <ul aria-label={`${cap.label} fallback models`} className="grid min-w-0 gap-2 xl:grid-cols-2">
            {models.map((model, index) => (
              <li key={`${model}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
                <span className="w-5 shrink-0 text-center text-xs font-medium text-text-muted">{index + 1}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-main" title={model}>{model}</code>
                <CapacityBadges caps={getCaps?.(model)} />
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => handleMove(index, -1)} disabled={index === 0} className="size-9 sm:size-7" title="Move up" aria-label={`Move ${model} up`}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleMove(index, 1)} disabled={index === models.length - 1} className="size-9 sm:size-7" title="Move down" aria-label={`Move ${model} down`}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleRemove(index)} className="size-9 text-destructive sm:size-7" title="Remove" aria-label={`Remove ${model}`}><X /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {showModelSelect && (
        <ModelSelectModal isOpen={showModelSelect} onClose={() => setShowModelSelect(false)} onSelect={handleAdd} onDeselect={handleDeselect} activeProviders={activeProviders as unknown as ActiveProvider[]} title={`Add ${cap.label} Model`} addedModelValues={models} capFilter={cap.key} closeOnSelect={false} />
      )}
    </Card>
  );
}
