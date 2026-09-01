"use client";

import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";

export function GlobalModelsCard({
  globalModels, onRemoveModel, onAddClick,
}: {
  globalModels: string[];
  onRemoveModel: (model: string) => void;
  onAddClick: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-main">{translate("Always available models")}</h2>
            <p className="mt-1 text-sm text-text-muted">{translate("These models are added as options for any request type, in addition to the specific priorities defined below. Leave empty to keep selection 100% automatic.")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onAddClick}><Plus data-icon="inline-start" /> {translate("Add Model")}</Button>
        </div>
        {globalModels.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">{translate("No fixed models; selection remains 100% automatic.")}</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {globalModels.map((model, index) => (
              <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
                <span className="text-xs text-text-muted">{index + 1}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
                <Button variant="ghost" size="icon-sm" onClick={() => onRemoveModel(model)} aria-label={`${translate("Remove") || "Remove"} ${model}`}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
