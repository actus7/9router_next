"use client";

import { useState } from "react";
import { Layers, Plus } from "lucide-react";
import Modal from "@/shared/components/Modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { ModelPriorityList } from "./ModelPriorityList";

type ScopeProps = {
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  models: string[];
  onRemoveModel: (model: string) => void;
  onAddClick: () => void;
};

/**
 * Which models this combo routes to, behind a button. "All" ranks the whole
 * inventory and the list only puts models ahead of it; "selected" makes the
 * list the combo — the columns, the AI suggestion and the router see nothing
 * else. It used to be a full card above the lanes; it is edited rarely, so it
 * lives in a dialog and the button says what is set.
 */
export function ModelScopeButton(props: ScopeProps) {
  const [open, setOpen] = useState(false);
  const { selected, models } = props;
  const label = selected ? translate("Chosen models") : translate("Always considered");
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Layers data-icon="inline-start" />
        {translate("Combo models")}
        <span className="ml-1 rounded bg-muted px-1.5 text-xs font-normal text-text-muted tabular-nums">
          {label}: {models.length}
        </span>
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title={translate("Combo models") || "Combo models"} size="2xl">
        <ModelScopeEditor {...props} />
      </Modal>
    </>
  );
}

function ModelScopeEditor({ selected, onSelectedChange, models, onRemoveModel, onAddClick }: ScopeProps) {
  const options = [
    { value: false, label: translate("All available models"), hint: translate("Ranks your whole inventory. Models listed here are tried first.") },
    { value: true, label: translate("Only the models I choose"), hint: translate("Routes only to the models listed here, spread across the columns below.") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{translate("Which models this combo may answer with.")}</p>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={translate("Combo models") || "Combo models"}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected === option.value}
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
        <div className="max-h-[50vh] overflow-y-auto">
          <ModelPriorityList
            models={models}
            onRemove={onRemoveModel}
            emptyHint={selected
              ? translate("No model chosen yet — requests will fail until you add one.") || "No model chosen yet — requests will fail until you add one."
              : translate("Nothing pinned; selection stays 100% automatic.") || "Nothing pinned; selection stays 100% automatic."}
          />
        </div>
      </section>
    </div>
  );
}
