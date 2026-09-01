"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface DisabledModelsSectionProps {
  disabledDisplayModels: Array<{ id: string; name?: string }>;
  onEnableModel: (id: string) => void;
}

export default function DisabledModelsSection({
  disabledDisplayModels,
  onEnableModel,
}: DisabledModelsSectionProps) {
  if (disabledDisplayModels.length === 0) return null;

  return (
    <div className="col-span-full mt-2">
      <p className="text-xs text-text-muted mb-2">Disabled models ({disabledDisplayModels.length}):</p>
      <div className="flex flex-wrap gap-2">
        {disabledDisplayModels.map((mm) => (
          <Button
            key={`disabled-${mm.id}`}
            variant="outline"
            onClick={() => onEnableModel(mm.id)}
            className="border-dashed text-xs"
            title="Restore model"
          >
            <Plus className="size-3" />
            {mm.id}
          </Button>
        ))}
      </div>
    </div>
  );
}
