"use client";

import type { useRouter } from "next/navigation";
import CompatibleNodeHeader from "./connections/CompatibleNodeHeader";
import ConnectionsToolbar from "./connections/ConnectionsToolbar";
import EmptyConnectionsState from "./connections/EmptyConnectionsState";
import ConnectionsList from "./connections/ConnectionsList";
import BulkProxyModal from "./connections/BulkProxyModal";
import OneByOneSummaryBar from "./connections/OneByOneSummaryBar";
import ConnectionsBottomActions from "./connections/ConnectionsBottomActions";
import ConnectionsModals from "./connections/ConnectionsModals";
import { FreeNoAuthSection } from "./connections/FreeNoAuthSection";
import type { ProviderInfo, ProxyPool } from "../types";

interface ConnectionsSectionProps {
  providerId: string;
  providerInfo: ProviderInfo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connectionsHook: any;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  isFreeNoAuth: boolean;
  isOAuth: boolean;
  hasDualAuthModes: boolean;
  oauthConnectionLabel: string;
  apiKeyConnectionLabel: string;
  router: ReturnType<typeof useRouter>;
}

export default function ConnectionsSection({
  providerId, providerInfo, connectionsHook: c, isCompatible, isAnthropicCompatible,
  isFreeNoAuth, isOAuth, hasDualAuthModes, oauthConnectionLabel, apiKeyConnectionLabel, router,
}: ConnectionsSectionProps) {
  const activePools = (c.proxyPools as ProxyPool[]).filter((p) => p.isActive === true);

  const handleDeleteProviderNode = () => {
    c.setConfirmState({
      title: "Delete Compatible Node",
      message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
      onConfirm: async () => {
        c.setConfirmState(null);
        try { const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" }); if (res.ok) router.push("/dashboard/providers"); }
        catch (error) { console.error("Error deleting provider node:", error); }
      },
    });
  };

  const handleUpdateProxy = async (connId: string, proxyPoolId: string | null) => {
    try {
      const res = await fetch(`/api/providers/${connId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId: proxyPoolId || null }) });
      if (res.ok) c.setConnections((prev: Array<{ id: string; providerSpecificData?: Record<string, unknown> }>) => prev.map((item: { id: string; providerSpecificData?: Record<string, unknown> }) => item.id === connId ? { ...item, providerSpecificData: { ...item.providerSpecificData, proxyPoolId: proxyPoolId ?? undefined } } : item));
    } catch (error) { console.error("Error updating proxy:", error); }
  };

  const showConnectionsSection = !isFreeNoAuth || (providerInfo?.authType === "apikey" && c.showOptionalKeySection);

  return (
    <>
      {isCompatible && c.providerNode && (
        <CompatibleNodeHeader isAnthropicCompatible={isAnthropicCompatible} providerNode={c.providerNode}
          onAddApiKey={() => { c.setAddConnectionError(""); c.setShowAddApiKeyModal(true); }}
          onEditNode={() => c.setShowEditNodeModal(true)} onDeleteNode={handleDeleteProviderNode} />
      )}

      <FreeNoAuthSection isFreeNoAuth={isFreeNoAuth} providerId={providerId} providerInfo={providerInfo} showOptionalKeySection={c.showOptionalKeySection} onShowOptionalKey={() => c.setShowOptionalKeySection(true)} />

      {showConnectionsSection && (
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="connections-heading">
          <ConnectionsToolbar isFreeNoAuth={isFreeNoAuth} showOptionalKeySection={c.showOptionalKeySection} onHideOptionalKey={() => c.setShowOptionalKeySection(false)} connections={c.connections} allSelected={c.allSelected} onSelectAll={c.setSelectedConnectionIds} isCompatible={isCompatible} providerId={providerId} hasDualAuthModes={hasDualAuthModes} onAdd={() => c.triggerAddConnection(isOAuth)} proxyPools={c.proxyPools} onShowBulkProxy={() => c.setShowBulkProxyModal(true)} selectedCount={c.selectedConnectionIds.length} onBulkDelete={c.handleBulkDelete} oneByOneRunning={c.oneByOneRunning} onRunOneByOne={c.handleRunOneByOneTest} oneByOneStopping={c.oneByOneStopping} onStopOneByOne={c.handleStopOneByOneTest} providerStrategy={c.providerStrategy} onRoundRobinToggle={c.handleRoundRobinToggle} providerStickyLimit={c.providerStickyLimit} onStickyLimitChange={c.handleStickyLimitChange} />

          {c.connections.length === 0 ? (
            <EmptyConnectionsState isOAuth={isOAuth} hasDualAuthModes={hasDualAuthModes} oauthConnectionLabel={oauthConnectionLabel} apiKeyConnectionLabel={apiKeyConnectionLabel} onTriggerOAuth={() => c.triggerOAuthConnection(isOAuth)} onTriggerApiKey={c.triggerApiKeyConnection} providerId={providerId} onAddConnection={() => c.triggerAddConnection(isOAuth)} onShowIFlowCookie={() => c.setShowIFlowCookieModal(true)} onShowBulkImportCodex={() => c.setShowBulkImportCodex(true)} />
          ) : (
            <>
              {c.oneByOneSummary && <OneByOneSummaryBar summary={c.oneByOneSummary} running={c.oneByOneRunning} currentConnectionId={c.oneByOneCurrentConnectionId} connections={c.connections} />}
              <ConnectionsList connections={c.connections} isSelected={c.isSelected} setSelectedConnectionIds={c.setSelectedConnectionIds} proxyPools={c.proxyPools} isOAuth={isOAuth} providerId={providerId} autoPing={c.autoPing} handleAutoPingConnection={c.handleAutoPingConnection} handleSwapPriority={c.handleSwapPriority} handleUpdateConnectionStatus={c.handleUpdateConnectionStatus} setSelectedConnection={c.setSelectedConnection} setShowEditModal={c.setShowEditModal} handleDelete={c.handleDelete} oneByOneResults={c.oneByOneResults} onUpdateProxy={handleUpdateProxy} />
              <ConnectionsBottomActions providerId={providerId} isCompatible={isCompatible} hasDualAuthModes={hasDualAuthModes} isOAuth={isOAuth} oauthConnectionLabel={oauthConnectionLabel} apiKeyConnectionLabel={apiKeyConnectionLabel} onTriggerOAuth={() => c.triggerOAuthConnection(isOAuth)} onTriggerApiKey={c.triggerApiKeyConnection} onAddConnection={() => c.triggerAddConnection(isOAuth)} onShowIFlowCookie={() => c.setShowIFlowCookieModal(true)} onShowBulkImportCodex={() => c.setShowBulkImportCodex(true)} />
            </>
          )}
        </section>
      )}

      <BulkProxyModal isOpen={c.showBulkProxyModal} onClose={c.closeBulkProxyModal} connectionCount={c.connections.length} onApplyOneToOne={c.handleApplyOneToOne} onApplySinglePool={c.handleApplySinglePool} bulkUpdatingProxy={c.bulkUpdatingProxy} activePools={activePools} proxyPools={c.proxyPools as ProxyPool[]} />
      <ConnectionsModals providerId={providerId} providerInfo={providerInfo} isCompatible={isCompatible} isAnthropicCompatible={isAnthropicCompatible} isOAuth={isOAuth} c={c} />
    </>
  );
}
