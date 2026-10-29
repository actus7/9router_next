"use client";

import { Plus } from "lucide-react";
import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { ModelPriorityList } from "./ModelPriorityList";

/**
 * Which models this combo routes to. "All" ranks the whole inventory and the
 * list only puts models ahead of it; "selected" makes the list the combo —
 * the columns, the AI suggestion and the router see nothing else.
 */
export function ModelScopeCard({
  selected, onSelectedChange, models, onRemoveModel, onAddClick,
  freeFallback, onFreeFallbackChange,
}: {
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  models: string[];
  onRemoveModel: (model: string) => void;
  onAddClick: () => void;
  freeFallback: boolean;
  onFreeFallbackChange: (enabled: boolean) => void;
}) {
  const options = [
    { value: false, label: translate("All available models"), hint: translate("Ranks your whole inventory. Models listed here are tried first.") },
    { value: true, label: translate("Only the models I choose"), hint: translate("Routes only to the models listed here, spread across the columns below.") },
  ];

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-main">{translate("Combo models")}</h2>
          <p className="mt-1 text-sm text-text-muted">{translate("Which models this combo may answer with.")}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={translate("Combo models") || "Combo models"}>
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected === option.value}
              onClick={() => onSelectedChange(option.value)}
              className={cn("rounded-lg border p-3 text-left transition-colors", selected === option.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}
            >
              <span className="block text-sm font-medium text-text-main">{option.label}</span>
              <span className="mt-1 block text-xs text-text-muted">{option.hint}</span>
            </button>
          ))}
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-text-main">
              {selected ? translate("Chosen models") : translate("Always considered")}
              <span className="ml-1.5 text-xs font-normal text-text-muted">{models.length}</span>
            </h3>
            <Button variant="outline" size="sm" onClick={onAddClick}>
              <Plus data-icon="inline-start" /> {translate("Add model")}
            </Button>
          </div>
          <ModelPriorityList
            models={models}
            onRemove={onRemoveModel}
            emptyHint={selected
              ? translate("No model chosen yet — requests will fail until you add one.") || "No model chosen yet — requests will fail until you add one."
              : translate("Nothing pinned; selection stays 100% automatic.") || "Nothing pinned; selection stays 100% automatic."}
          />
        </section>

        <label className="flex items-start justify-between gap-4 border-t border-border-subtle pt-4">
          <span>
            <span className="block text-sm font-medium text-text-main">{translate("Free model as last resort")}</span>
            <span className="mt-0.5 block text-xs text-text-muted">{translate("When every model above fails or runs out of accounts, answer with the free Kilo router instead of an error.")}</span>
          </span>
          <Switch checked={freeFallback} onCheckedChange={onFreeFallbackChange} />
        </label>
      </div>
    </Card>
  );
}
