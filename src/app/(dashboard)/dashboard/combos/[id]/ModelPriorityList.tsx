"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";

/**
 * A numbered, ordered list of pinned models.
 *
 * The global list and every per-need list render the same thing: position,
 * model key, remove. It lived twice in two cards that have since merged.
 */
export function ModelPriorityList({
  models, onRemove, emptyHint,
}: {
  models: string[];
  onRemove: (model: string) => void;
  emptyHint: string;
}) {
  if (models.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">
        {emptyHint}
      </p>
    );
  }

  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {models.map((model, index) => (
        <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <span className="text-xs text-text-muted">{index + 1}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(model)}
            aria-label={`${translate("Remove") || "Remove"} ${model}`}
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}
