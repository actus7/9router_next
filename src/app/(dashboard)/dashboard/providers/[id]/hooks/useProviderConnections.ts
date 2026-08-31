"use client";

import { useCallback, useEffect, useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { useConnectionModals } from "./useConnectionModals";
import { useProviderSettings } from "./useProviderSettings";
import { useOneByOneTest } from "./useOneByOneTest";
import { useBulkProxy } from "./useBulkProxy";
import { createConnectionCrud } from "./connectionCrudHelpers";
import type {
  Connection,
  ProviderNode,
  ProxyPool,
} from "../types";

interface UseProviderConnectionsArgs {
  providerId: string;
  initialConnections: Connection[];
  initialProvider: ProviderNode | null;
  initialPools: ProxyPool[];
  initialSettings: Record<string, unknown>;
  isCompatible: boolean;
}

export function useProviderConnections({
  providerId,
  initialConnections,
  initialProvider,
  initialPools,
  initialSettings,
  isCompatible,
}: UseProviderConnectionsArgs) {
  const notify = useNotificationStore();

  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [showOptionalKeySection, setShowOptionalKeySection] = useState<boolean>(initialConnections.length > 0);
  const [loading, setLoading] = useState<boolean>(false);
  const [providerNode, setProviderNode] = useState<ProviderNode | null>(initialProvider);
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>(initialPools);

  const settingsHook = useProviderSettings({ providerId, initialSettings });

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter((c: Connection) => c.provider === providerId);
        setConnections(filtered);
      }
      if (proxyPoolsRes.ok) setProxyPools(proxyPoolsData.proxyPools || []);
      settingsHook.loadSettings(settingsData);
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry: ProviderNode) => entry.id === providerId) || null;
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry: ProviderNode) => entry.id === providerId) || null;
            if (node) break;
          }
        }
        setProviderNode(node);
      }
    } catch (error) { console.error("Error fetching connections:", error); }
    finally { setLoading(false); }
  }, [providerId, isCompatible]);

  const modalsHook = useConnectionModals({ providerId, initialConnections, initialProvider, isCompatible, fetchConnections });
  const oneByOneHook = useOneByOneTest({ connections });
  const bulkProxyHook = useBulkProxy({ connections, proxyPools, fetchConnections });

  const crud = createConnectionCrud({ setConnections, setConfirmState: modalsHook.setConfirmState, selectedConnectionIds: bulkProxyHook.selectedConnectionIds, setSelectedConnectionIds: bulkProxyHook.setSelectedConnectionIds, notify });

  const handleSwapPriority = (index1: number, index2: number) => crud.handleSwapPriority(connections, index1, index2, fetchConnections);

  useEffect(() => {
    bulkProxyHook.setSelectedConnectionIds((prev) => prev.filter((id) => connections.some((conn) => conn.id === id)));
  }, [connections]);

  return {
    connections, setConnections,
    showOptionalKeySection, setShowOptionalKeySection,
    loading, providerNode, proxyPools,
    showOAuthModal: modalsHook.showOAuthModal, setShowOAuthModal: modalsHook.setShowOAuthModal,
    showIFlowCookieModal: modalsHook.showIFlowCookieModal, setShowIFlowCookieModal: modalsHook.setShowIFlowCookieModal,
    showAddApiKeyModal: modalsHook.showAddApiKeyModal, setShowAddApiKeyModal: modalsHook.setShowAddApiKeyModal,
    addConnectionError: modalsHook.addConnectionError, setAddConnectionError: modalsHook.setAddConnectionError,
    showBulkImportCodex: modalsHook.showBulkImportCodex, setShowBulkImportCodex: modalsHook.setShowBulkImportCodex,
    showEditModal: modalsHook.showEditModal, setShowEditModal: modalsHook.setShowEditModal,
    showEditNodeModal: modalsHook.showEditNodeModal, setShowEditNodeModal: modalsHook.setShowEditNodeModal,
    showBulkProxyModal: bulkProxyHook.showBulkProxyModal, setShowBulkProxyModal: bulkProxyHook.setShowBulkProxyModal,
    selectedConnection: modalsHook.selectedConnection, setSelectedConnection: modalsHook.setSelectedConnection,
    selectedConnectionIds: bulkProxyHook.selectedConnectionIds, setSelectedConnectionIds: bulkProxyHook.setSelectedConnectionIds,
    bulkUpdatingProxy: bulkProxyHook.bulkUpdatingProxy,
    confirmState: modalsHook.confirmState, setConfirmState: modalsHook.setConfirmState,
    showAgRiskModal: modalsHook.showAgRiskModal, setShowAgRiskModal: modalsHook.setShowAgRiskModal,
    providerStrategy: settingsHook.providerStrategy, providerStickyLimit: settingsHook.providerStickyLimit,
    thinkingMode: settingsHook.thinkingMode, autoPing: settingsHook.autoPing, hasAutoPing: settingsHook.hasAutoPing,
    oneByOneRunning: oneByOneHook.oneByOneRunning, oneByOneStopping: oneByOneHook.oneByOneStopping,
    oneByOneCurrentConnectionId: oneByOneHook.oneByOneCurrentConnectionId,
    oneByOneResults: oneByOneHook.oneByOneResults, oneByOneSummary: oneByOneHook.oneByOneSummary,
    allSelected: bulkProxyHook.allSelected, isSelected: bulkProxyHook.isSelected,
    openOAuthConnection: modalsHook.openOAuthConnection, triggerOAuthConnection: modalsHook.triggerOAuthConnection,
    triggerApiKeyConnection: modalsHook.triggerApiKeyConnection, triggerAddConnection: modalsHook.triggerAddConnection,
    handleAgRiskConfirm: modalsHook.handleAgRiskConfirm, fetchConnections,
    handleUpdateNode: modalsHook.handleUpdateNode,
    handleRoundRobinToggle: settingsHook.handleRoundRobinToggle, handleStickyLimitChange: settingsHook.handleStickyLimitChange,
    handleThinkingModeChange: settingsHook.handleThinkingModeChange, handleAutoPingConnection: settingsHook.handleAutoPingConnection,
    handleRunOneByOneTest: oneByOneHook.handleRunOneByOneTest, handleStopOneByOneTest: oneByOneHook.handleStopOneByOneTest,
    handleDelete: crud.handleDelete, handleBulkDelete: crud.handleBulkDelete,
    handleOAuthSuccess: modalsHook.handleOAuthSuccess, handleIFlowCookieSuccess: modalsHook.handleIFlowCookieSuccess,
    handleSaveApiKey: modalsHook.handleSaveApiKey, handleUpdateConnection: modalsHook.handleUpdateConnection,
    handleUpdateConnectionStatus: crud.handleUpdateConnectionStatus, handleSwapPriority,
    closeBulkProxyModal: bulkProxyHook.closeBulkProxyModal, applyProxyAssignments: bulkProxyHook.applyProxyAssignments,
    handleApplySinglePool: bulkProxyHook.handleApplySinglePool, handleApplyOneToOne: bulkProxyHook.handleApplyOneToOne,
  };
}

export { AUTO_PING_SETTINGS_KEYS } from "./useProviderSettings";
export type UseProviderConnectionsReturn = ReturnType<typeof useProviderConnections>;
