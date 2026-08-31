"use client";

import { Card } from "@/shared/components";
import { useGenericExampleState } from "./useGenericExampleState";
import GenericFormFields from "./GenericFormFields";
import GenericResponseSection from "./GenericResponseSection";

export function GenericExampleCard({ providerId, kind }: { providerId: string; kind: string }) {
  const state = useGenericExampleState({ providerId, kind });

  if (!state) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        <GenericFormFields state={state} />
        <GenericResponseSection state={state} />
      </div>
    </Card>
  );
}
