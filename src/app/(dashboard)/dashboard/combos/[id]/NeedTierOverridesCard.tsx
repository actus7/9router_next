"use client";

import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button, Card, Select } from "@/shared/components";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";
import type { RouteNeed, RoutingTierOrDefault } from "@/shared/llm-catalog";

export function NeedTierOverridesCard({
  selectedNeed, onNeedChange, selectedTier, onTierChange,
  currentModels, onRemoveModel, onAddClick,
  needOptions, needLabels, tierLabels, tierOptionsForNeed,
}: {
  selectedNeed: RouteNeed;
  onNeedChange: (need: RouteNeed) => void;
  selectedTier: RoutingTierOrDefault;
  onTierChange: (tier: RoutingTierOrDefault) => void;
  currentModels: string[];
  onRemoveModel: (model: string) => void;
  onAddClick: () => void;
  needOptions: { value: string; label: string }[];
  needLabels: Record<RouteNeed, string>;
  tierLabels: Record<RoutingTierOrDefault, string>;
  tierOptionsForNeed: RoutingTierOrDefault[];
}) {
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-text-main">{translate("Priorities by request type")}</h2>
          <p className="mt-1 text-sm text-text-muted">{translate("For special requests (image, voice, web search...), choose which models to use first. Automatic selection remains the base — this only gives priority when the model is compatible.")}</p>
        </div>
        <p className="text-xs text-text-muted">{translate("For general text requests, the complexity tiers (Simple/Standard/Complex/Reasoning) are already edited in the \"Default routing\" board above — no need to repeat here.")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-xs text-text-muted">{translate("Request type")}</Label>
            <Select options={needOptions} value={selectedNeed} onChange={(value) => onNeedChange(value as RouteNeed)} ariaLabel={translate("Request type") || "Request type"} />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs text-text-muted">{translate("Complexity level")}</Label>
            <Select options={tierOptionsForNeed.map((tier) => ({ value: tier, label: tierLabels[tier] }))} value={selectedTier} onChange={(value) => onTierChange(value as RoutingTierOrDefault)} ariaLabel={translate("Complexity level") || "Complexity level"} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-text-main">{needLabels[selectedNeed]} <ChevronRight className="inline size-3" /> {tierLabels[selectedTier]}</p>
              <p className="text-xs text-text-muted">{translate("Priority order chosen by you")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onAddClick}><Plus data-icon="inline-start" /> {translate("Add Model")}</Button>
          </div>
          {currentModels.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">{translate("No priority set; selection remains 100% automatic.")}</p>
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {currentModels.map((model, index) => (
                <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
                  <span className="text-xs text-text-muted">{index + 1}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
                  <Button variant="ghost" size="icon-sm" onClick={() => onRemoveModel(model)} aria-label={`${translate("Remove") || "Remove"} ${model}`}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
