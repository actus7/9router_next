"use client";

import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { Trash2 } from "lucide-react";

interface ClearConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  clearingModels: boolean;
}

export default function ClearConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  clearingModels,
}: ClearConfirmationModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      title={translate("Clear all models") || "Clear all models"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          {translate("This removes every custom model and alias for this provider and excludes its current models from chat. Refresh Models will rebuild a clean catalog from the provider.")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={clearingModels}>
            {translate("Cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await onConfirm();
              onClose();
            }}
            disabled={clearingModels}
          >
            <Trash2 className="size-4 mr-1.5" />
            {clearingModels ? translate("Clearing...") : translate("Clear All Models")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
