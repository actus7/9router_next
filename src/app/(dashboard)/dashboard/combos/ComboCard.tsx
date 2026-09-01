"use client";

import { useState } from "react";
import { Card, ModelSelectModal, CapacityBadges, Select } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import type { Connection } from "@/lib/data-access";
import type { ComboView, ModelCapsGetter, Strategy } from "./combo-types";
import { STRATEGY_OPTIONS } from "./combo-types";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import Link from "next/link";
import { BrainCircuit, Check, Copy, Gavel, Layers, Pencil, Trash2, X } from "lucide-react";

export function ComboCard({ combo, getCaps, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy }: {
  combo: ComboView; getCaps: ModelCapsGetter; activeProviders?: Connection[]; copied: string | null;
  onCopy: (value: string, id: string) => void; onEdit: () => void; onDelete: () => void;
  strategy?: Strategy; onSetStrategy: (patch: Partial<Strategy>) => void;
}) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const isSmart = combo.kind === "smart";
  const copyId = `combo-${combo.id}`;

  return (
    <Card padding="sm" className="group">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Layers aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
              {isSmart && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Smart</span>}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              {isSmart && combo.models.length === 0 ? (
                <span className="text-xs text-text-muted">{translate("Active inventory dynamically ranked")}</span>
              ) : combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">{translate("No models")}</span>
              ) : (
                combo.models.slice(0, 3).map((model) => (
                  <code key={model} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs text-text-muted">
                    <span className="truncate">{model}</span><CapacityBadges caps={getCaps?.(model)} />
                  </code>
                ))
              )}
              {combo.models.length > 3 && <span className="text-xs text-text-muted">+{combo.models.length - 3} {translate("more") || "more"}</span>}
            </div>
            {isFusion && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-text-muted">{translate("Judge") || "Judge"}</span>
                <Button variant="outline" size="sm" onClick={() => setShowJudgeSelect(true)} className="min-h-9 max-w-full border-dashed font-mono" title="Pick the model that fuses panel answers">
                  <Gavel data-icon="inline-start" /><span className="truncate">{judge || `Auto — ${combo.models[0] || (translate("first model") || "first model")}`}</span>
                </Button>
                {judge && <Button variant="ghost" size="icon-sm" onClick={() => onSetStrategy({ judgeModel: "" })} className="text-destructive" title="Reset judge to Auto" aria-label="Reset judge to Auto"><X /></Button>}
              </div>
            )}
          </div>
        </div>
        {/* Actions */}
        <div className="grid w-full gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:w-auto lg:grid-cols-[220px_auto] lg:items-end">
          {isSmart ? (
            <div className="flex min-h-10 items-center rounded-lg bg-muted px-3 text-xs text-text-muted">{translate("Complexity + task + capabilities")}</div>
          ) : (
            <div className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">{translate("Strategy")}</span>
              <Select options={STRATEGY_OPTIONS} value={current} onChange={(value) => onSetStrategy({ fallbackStrategy: value })} ariaLabel={`Strategy for ${combo.name}`} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onCopy(combo.name, copyId); }} className="min-h-11 sm:min-h-10" title="Copy combo name" aria-label="Copy combo name">
              {copied === copyId ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              <span>{copied === copyId ? (translate("Copied") || "Copied") : (translate("Copy") || "Copy")}</span>
            </Button>
            {isSmart ? (
              <Link href={`/dashboard/combos/${combo.id}`} aria-label={`Configurar ${combo.name}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 sm:min-h-10")}>
                <BrainCircuit data-icon="inline-start" /><span>{translate("Configure") || "Configure"}</span>
              </Link>
            ) : (
              <Button variant="ghost" size="sm" onClick={onEdit} className="min-h-11 sm:min-h-10" title="Edit" aria-label={`Edit ${combo.name}`}>
                <Pencil data-icon="inline-start" /><span>{translate("Edit") || "Edit"}</span>
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={onDelete} className="min-h-11 sm:min-h-10" title={translate("Delete") || "Delete"} aria-label={`Delete ${combo.name}`}>
              <Trash2 data-icon="inline-start" /><span>{translate("Delete")}</span>
            </Button>
          </div>
        </div>
      </div>
      {showJudgeSelect && (
        <ModelSelectModal isOpen={showJudgeSelect} onClose={() => setShowJudgeSelect(false)} onSelect={(m: { value: string }) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }} activeProviders={activeProviders as unknown as ActiveProvider[]} title="Select Judge Model" addedModelValues={judge ? [judge] : []} closeOnSelect={true} />
      )}
    </Card>
  );
}
