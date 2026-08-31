"use client";

import { Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import AddCompatibleModal from "./AddCompatibleModal";
import { ProviderTestResultsView } from "./ProviderTestResultsView";
import type { ProviderNode, TestResults } from "../types";

interface ModalsProps {
  showAddCompatibleModal: boolean;
  onCloseAddCompatible: () => void;
  showAddAnthropicCompatibleModal: boolean;
  onCloseAddAnthropicCompatible: () => void;
  onNodeCreated: (node: ProviderNode) => void;
  testResults: TestResults | null;
  onCloseTestResults: () => void;
}

export function Modals({
  showAddCompatibleModal,
  onCloseAddCompatible,
  showAddAnthropicCompatibleModal,
  onCloseAddAnthropicCompatible,
  onNodeCreated,
  testResults,
  onCloseTestResults,
}: ModalsProps) {
  return (
    <>
      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={onCloseAddCompatible}
        onCreated={(node) => {
          onNodeCreated(node as unknown as ProviderNode);
          onCloseAddCompatible();
        }}
      />
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={onCloseAddAnthropicCompatible}
        onCreated={(node) => {
          onNodeCreated(node as unknown as ProviderNode);
          onCloseAddAnthropicCompatible();
        }}
      />
      <Modal
        isOpen={!!testResults}
        onClose={onCloseTestResults}
        title={translate("Test Results") || "Test Results"}
        size="full"
      >
        {testResults && <ProviderTestResultsView results={testResults} />}
      </Modal>
    </>
  );
}
