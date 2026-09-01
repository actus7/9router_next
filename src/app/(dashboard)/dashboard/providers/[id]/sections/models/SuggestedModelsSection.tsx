"use client";

import { Button } from "@/shared/components";
import { Plus } from "lucide-react";
import type { SuggestedModel } from "../../types";

interface SuggestedModelsSectionProps {
  suggestedModels: SuggestedModel[];
  disabledModelIds: string[];
  addedFullModels: Set<string>;
  hardcodedIds: Set<string>;
  providerStorageAlias: string;
  onAdd: (modelId: string, type: string, alias: string) => Promise<void>;
}

export default function SuggestedModelsSection({
  suggestedModels,
  disabledModelIds,
  addedFullModels,
  hardcodedIds,
  providerStorageAlias,
  onAdd,
}: SuggestedModelsSectionProps) {
  const notAdded = suggestedModels.filter(
    (mm) => !disabledModelIds.includes(mm.id) && !addedFullModels.has(`${providerStorageAlias}/${mm.id}`) && !hardcodedIds.has(mm.id)
  );
  if (notAdded.length === 0) return null;

  return (
    <div className="col-span-full mt-2">
      <p className="text-xs text-text-muted mb-2">Suggested free models (≥200k context):</p>
      <div className="flex flex-wrap gap-2">
        {notAdded.map((mm) => (
          <Button
            key={mm.id}
            variant="outline"
            onClick={async () => { await onAdd(mm.id, "llm", providerStorageAlias); }}
            className="text-xs"
            title={`${mm.name} · ${((mm.contextLength ?? 0) / 1000).toFixed(0)}k ctx`}
          >
            <Plus className="size-3" />
            {mm.id.split("/").pop()}
          </Button>
        ))}
      </div>
    </div>
  );
}
