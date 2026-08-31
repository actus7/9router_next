"use client";

import {
  IFlowCookieModal,
  EditConnectionModal,
  ConfirmModal,
} from "@/shared/components";
import { translate } from "@/i18n/runtime";
import AddApiKeyModal from "../../AddApiKeyModal";
import EditCompatibleNodeModal from "../../EditCompatibleNodeModal";
import BulkImportCodexModal from "../../BulkImportCodexModal";
import OAuthModalSelector from "./OAuthModalSelector";
import type { UseProviderConnectionsReturn } from "../../hooks/useProviderConnections";
import type { ProviderInfo } from "../../types";

interface ConnectionsModalsProps {
  providerId: string;
  providerInfo: ProviderInfo;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  isOAuth: boolean;
  c: UseProviderConnectionsReturn;
}

export default function ConnectionsModals({
  providerId,
  providerInfo,
  isCompatible,
  isAnthropicCompatible,
  isOAuth,
  c,
}: ConnectionsModalsProps) {
  return (
    <>
      <OAuthModalSelector
        providerId={providerId}
        providerInfo={providerInfo}
        isOpen={c.showOAuthModal}
        onSuccess={c.handleOAuthSuccess}
        onClose={() => c.setShowOAuthModal(false)}
      />
      {providerId === "iflow" && (
        <IFlowCookieModal
          isOpen={c.showIFlowCookieModal}
          onSuccess={c.handleIFlowCookieSuccess}
          onClose={() => c.setShowIFlowCookieModal(false)}
        />
      )}
      <AddApiKeyModal
        isOpen={c.showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={c.proxyPools}
        error={c.addConnectionError}
        existingNames={c.connections.map((conn) => conn.name).filter(Boolean) as string[]}
        onSave={c.handleSaveApiKey}
        onBulkDone={c.fetchConnections}
        onClose={() => {
          c.setAddConnectionError("");
          c.setShowAddApiKeyModal(false);
        }}
      />
      <EditConnectionModal
        isOpen={c.showEditModal}
        connection={c.selectedConnection}
        proxyPools={c.proxyPools}
        onSave={c.handleUpdateConnection}
        onClose={() => c.setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={c.showEditNodeModal}
          node={c.providerNode}
          onSave={c.handleUpdateNode}
          onClose={() => c.setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {providerId === "codex" && (
        <BulkImportCodexModal
          isOpen={c.showBulkImportCodex}
          onClose={() => c.setShowBulkImportCodex(false)}
          onSuccess={c.fetchConnections}
        />
      )}
      <ConfirmModal
        isOpen={c.showAgRiskModal}
        onClose={() => c.setShowAgRiskModal(false)}
        onConfirm={() => c.handleAgRiskConfirm(isOAuth)}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText={translate("Cancel") || "Cancel"}
        variant="danger"
      />
      <ConfirmModal
        isOpen={!!c.confirmState}
        onClose={() => c.setConfirmState(null)}
        onConfirm={c.confirmState?.onConfirm ?? (() => {})}
        title={c.confirmState?.title || "Confirm"}
        message={c.confirmState?.message}
        variant="danger"
      />
    </>
  );
}
