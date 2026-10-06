"use client";

import { useMemo } from "react";
import ModelPickerShell from "@/shared/components/model-picker/ModelPickerShell";
import type { PickerGroup } from "@/shared/components/model-picker/modelPickerData";
import { useSystemOneModels } from "@/shared/hooks/useSystemOneModels";
import { translate } from "@/i18n/runtime";

/** Picks a System One model as a Fusion combo's judge, in the platform's model picker. */
export function SystemOneJudgePicker({ isOpen, onClose, onSelect, selected }: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  selected: string;
}) {
  const { data } = useSystemOneModels();
  const groups = useMemo<PickerGroup[]>(() => [{
    id: "typesafe-ai",
    name: "System One",
    models: (data?.models ?? []).map((model) => ({ key: model.id, name: model.name, subtitle: model.id })),
  }], [data]);

  return (
    <ModelPickerShell
      isOpen={isOpen}
      onClose={onClose}
      title={translate("Select System One judge") || "Select System One judge"}
      note={translate("A System One judge picks the best answer from the panel and returns it as is — it does not synthesize. When it is not confident enough, the combo falls back to the LLM judge.")}
      groups={groups}
      selectedKeys={selected ? [selected] : []}
      onPick={(model) => { onSelect(model.key); onClose(); }}
    />
  );
}
