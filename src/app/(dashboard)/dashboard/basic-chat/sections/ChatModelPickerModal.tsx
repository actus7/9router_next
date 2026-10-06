"use client";

import { useMemo } from "react";
import ModelPickerShell from "@/shared/components/model-picker/ModelPickerShell";
import type { PickerGroup } from "@/shared/components/model-picker/modelPickerData";
import { translate } from "@/i18n/runtime";
import type { ProviderGroup } from "../types";

interface ChatModelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  providerGroups: ProviderGroup[];
  activeProviderId: string;
  activeModelId: string;
}

/** The chat's model picker: the shared picker fed with the conversation's providers. */
export default function ChatModelPickerModal({
  isOpen, onClose, onSelect, providerGroups, activeProviderId, activeModelId,
}: ChatModelPickerModalProps) {
  const groups = useMemo<PickerGroup[]>(() => providerGroups.map((group) => ({
    id: group.providerId,
    name: group.providerName,
    models: group.models.map((model) => ({ key: model.id, name: model.name, subtitle: model.requestModel })),
  })), [providerGroups]);
  const selectedKeys = useMemo(() => (activeModelId ? [activeModelId] : []), [activeModelId]);

  return (
    <ModelPickerShell
      isOpen={isOpen}
      onClose={onClose}
      title={translate("Choose model") || "Choose model"}
      subtitle={translate("Select an active provider and model for this conversation.") || undefined}
      groups={groups}
      selectedKeys={selectedKeys}
      initialGroupId={activeProviderId || null}
      onPick={(model) => { onSelect(model.key); onClose(); }}
    />
  );
}
