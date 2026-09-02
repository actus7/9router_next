"use client";

import { useState } from "react";
import { Card } from "@/shared/components";
import AddCustomModelModal from "../AddCustomModelModal";
import ModelsGrid from "./models/ModelsGrid";
import ModelsToolbar from "./models/ModelsToolbar";
import TestDiagnosticsModal from "./models/TestDiagnosticsModal";
import ClearConfirmationModal from "./models/ClearConfirmationModal";
import type { UseProviderModelsReturn } from "../hooks/useProviderModels";
import type { Connection } from "../types";

interface ModelsSectionProps {
  providerId: string;
  providerStorageAlias: string;
  providerDisplayAlias: string;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  isFreeNoAuth: boolean;
  connections: Connection[];
  thinkingMode: string;
  onThinkingModeChange: (mode: string) => void;
  noModelDiscovery?: boolean;
  modelsHook: UseProviderModelsReturn;
}

export default function ModelsSection({
  providerId,
  providerStorageAlias,
  providerDisplayAlias,
  isCompatible,
  isAnthropicCompatible,
  isFreeNoAuth,
  connections,
  thinkingMode,
  onThinkingModeChange,
  noModelDiscovery,
  modelsHook: m,
}: ModelsSectionProps) {
  const [showClearConfirmation, setShowClearConfirmation] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  return (
    <>
      <Card padding="xs" className="overflow-visible">
        <ModelsToolbar
          providerId={providerId}
          isCompatible={isCompatible}
          thinkingMode={thinkingMode}
          onThinkingModeChange={onThinkingModeChange}
          noModelDiscovery={noModelDiscovery}
          modelsHook={m}
          onShowClearConfirmation={() => setShowClearConfirmation(true)}
          onShowDiagnostics={() => setDiagnosticsOpen(true)}
          models={m.models}
          kiloFreeModels={m.kiloFreeModels}
        />
        {!!m.modelsTestError && (
          <p className="text-xs text-destructive-foreground mb-3 break-words">{m.modelsTestError}</p>
        )}
        <ModelsGrid
          providerId={providerId}
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          isCompatible={isCompatible}
          isAnthropicCompatible={isAnthropicCompatible}
          isFreeNoAuth={isFreeNoAuth}
          connections={connections}
          thinkingMode={thinkingMode}
          modelsHook={m}
        />
      </Card>

      {!isCompatible && (
        <AddCustomModelModal
          isOpen={m.showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId: string) => {
            await m.handleAddCustomModel(modelId, "llm", providerStorageAlias);
            m.setShowAddCustomModel(false);
          }}
          onClose={() => m.setShowAddCustomModel(false)}
        />
      )}

      <ClearConfirmationModal
        isOpen={showClearConfirmation}
        onClose={() => setShowClearConfirmation(false)}
        onConfirm={m.handleClearProviderModels}
        clearingModels={m.clearingModels}
      />

      <TestDiagnosticsModal
        isOpen={diagnosticsOpen && !!m.testAllModels}
        onClose={() => setDiagnosticsOpen(false)}
        testAllModels={m.testAllModels}
        onCancelTests={m.handleCancelTestAllModels}
      />
    </>
  );
}
