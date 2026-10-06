"use client";

import Modal from "@/shared/components/Modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemOneModels } from "@/shared/hooks/useSystemOneModels";
import { translate } from "@/i18n/runtime";
import { Check, Cpu } from "lucide-react";

function t(text: string): string {
  return translate(text) || text;
}

/** Picks a System One model as a Fusion combo's judge. */
export function SystemOneJudgePicker({ isOpen, onClose, onSelect, selected }: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  selected: string;
}) {
  const { data, isLoading } = useSystemOneModels();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("Select System One judge")} size="md">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          {t("A System One judge picks the best answer from the panel and returns it as is — it does not synthesize. When it is not confident enough, the combo falls back to the LLM judge.")}
        </p>
        {isLoading || !data ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          data.models.map((model) => (
            <Button
              key={model.id}
              variant="outline"
              className="h-auto justify-start gap-3 py-2 text-left"
              onClick={() => { onSelect(model.id); onClose(); }}
            >
              <Cpu data-icon="inline-start" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{model.name}</span>
                <code className="truncate font-mono text-xs text-text-muted">{model.id}</code>
              </span>
              {selected === model.id && <Check className="ml-auto" aria-label={t("Selected")} />}
            </Button>
          ))
        )}
      </div>
    </Modal>
  );
}
