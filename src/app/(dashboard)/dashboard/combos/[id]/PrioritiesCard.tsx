"use client";

import { ChevronRight, Plus } from "lucide-react";
import Card from "@/shared/components/Card";
import Select from "@/shared/components/Select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { RouteNeed, RoutingTierOrDefault } from "@/shared/llm-catalog";
import { ModelPriorityList } from "./ModelPriorityList";
import type { ActiveScope } from "./smartComboHelpers";

/**
 * Everything the operator pins by hand, in one card.
 *
 * Two cards used to split it: one for `combo.models` ("always available") and
 * one for the need x tier grid. They overlapped — the grid's only option for
 * need=general was the `default` bucket, which is the very slot the router
 * merges `combo.models` into. The grid no longer offers `general`; the
 * complexity board above owns it.
 */
export function PrioritiesCard({
  globalModels, onRemoveGlobalModel, onAddGlobalClick,
  activeScopes, onScopeSelect,
  selectedNeed, onNeedChange, selectedTier, onTierChange,
  currentModels, onRemoveModel, onAddClick,
  needOptions, needLabels, tierLabels, tierOptions,
}: {
  globalModels: string[];
  onRemoveGlobalModel: (model: string) => void;
  onAddGlobalClick: () => void;
  activeScopes: ActiveScope[];
  onScopeSelect: (need: RouteNeed, tier: RoutingTierOrDefault) => void;
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
  tierOptions: RoutingTierOrDefault[];
}) {
  return (
    <Card>
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-base font-semibold text-text-main">{translate("Model priorities")}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {translate("Optional. Automatic selection already ranks by capability, quality, reliability, latency and price — pin a model only to put it ahead of that.")}
          </p>
        </div>

        {/* Global list: applies to the detected type and to general */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-medium text-text-main">{translate("Always considered")}</h3>
              <p className="text-xs text-text-muted">
                {translate("Tried first for any request, whatever type is detected. The complexity board above wins when it has a model for the tier.")}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onAddGlobalClick}>
              <Plus data-icon="inline-start" /> {translate("Add model")}
            </Button>
          </div>
          <ModelPriorityList
            models={globalModels}
            onRemove={onRemoveGlobalModel}
            emptyHint={translate("Nothing pinned; selection stays 100% automatic.") || "Nothing pinned; selection stays 100% automatic."}
          />
        </section>

        {/* Per-need lists, general excluded — the board owns it */}
        <section className="flex flex-col gap-3 border-t border-border-subtle pt-6">
          <div>
            <h3 className="text-sm font-medium text-text-main">{translate("By request type")}</h3>
            <p className="text-xs text-text-muted">
              {translate("For images, voice, transcription, web search and the like. Only applies when the model is compatible with the type.")}
            </p>
          </div>

          {activeScopes.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={translate("Types with priorities set") || "Types with priorities set"}>
              {activeScopes.map((scope) => {
                const active = scope.need === selectedNeed && scope.tier === selectedTier;
                return (
                  <li key={`${scope.need}:${scope.tier}`}>
                    <Button
                      variant={active ? "secondary" : "outline"}
                      size="xs"
                      onClick={() => onScopeSelect(scope.need, scope.tier)}
                      className={cn(active && "ring-1 ring-primary/40")}
                    >
                      {needLabels[scope.need]}
                      <ChevronRight className="size-3" />
                      {tierLabels[scope.tier]}
                      <span className="ml-1 rounded-full bg-surface px-1.5 text-[10px] text-text-muted">{scope.count}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">{translate("Request type")}</Label>
              <Select
                options={needOptions}
                value={selectedNeed}
                onChange={(value) => onNeedChange(value as RouteNeed)}
                ariaLabel={translate("Request type") || "Request type"}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">{translate("Complexity level")}</Label>
              <Select
                options={tierOptions.map((tier) => ({ value: tier, label: tierLabels[tier] }))}
                value={selectedTier}
                onChange={(value) => onTierChange(value as RoutingTierOrDefault)}
                ariaLabel={translate("Complexity level") || "Complexity level"}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-text-main">
                {needLabels[selectedNeed]} <ChevronRight className="inline size-3" /> {tierLabels[selectedTier]}
              </p>
              <Button variant="outline" size="sm" onClick={onAddClick}>
                <Plus data-icon="inline-start" /> {translate("Add model")}
              </Button>
            </div>
            <ModelPriorityList
              models={currentModels}
              onRemove={onRemoveModel}
              emptyHint={translate("No priority for this type; selection stays automatic.") || "No priority for this type; selection stays automatic."}
            />
          </div>
        </section>
      </div>
    </Card>
  );
}
