"use client";

import { useState } from "react";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import type { Connection, ProxyPool } from "../types";

interface UseBulkProxyArgs {
  connections: Connection[];
  proxyPools: ProxyPool[];
  fetchConnections: () => Promise<void>;
}

export function useBulkProxy({ connections, proxyPools, fetchConnections }: UseBulkProxyArgs) {
  const notify = useNotificationStore();
  const [showBulkProxyModal, setShowBulkProxyModal] = useState<boolean>(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState<boolean>(false);

  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;
  const isSelected = (connectionId: string) => selectedConnectionIds.includes(connectionId);

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const applyProxyAssignments = async (assignments: Array<{ connectionId: string; proxyPoolId: string | null }>) => {
    setBulkUpdatingProxy(true);
    try {
      let failed = 0;
      for (const { connectionId, proxyPoolId } of assignments) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId }),
          });
          if (!res.ok) failed += 1;
        } catch (e) {
          console.error("Error applying proxy for", connectionId, e);
          failed += 1;
        }
      }
      if (failed > 0) notify.warning(translate("Updated with") + ` ${failed} ` + translate("failed request(s)") + ".");
      await fetchConnections();
      setShowBulkProxyModal(false);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };

  const handleApplySinglePool = (proxyPoolId: string | null) => {
    const targets = connections.map((c) => ({ connectionId: c.id, proxyPoolId }));
    return applyProxyAssignments(targets);
  };

  const handleApplyOneToOne = () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) {
      notify.warning(translate("No active proxy pools available.") || "No active proxy pools available.");
      return;
    }
    const targets = connections.map((c, i) => ({
      connectionId: c.id,
      proxyPoolId: activePools[i % activePools.length].id,
    }));
    return applyProxyAssignments(targets);
  };

  return {
    showBulkProxyModal,
    setShowBulkProxyModal,
    selectedConnectionIds,
    setSelectedConnectionIds,
    bulkUpdatingProxy,
    allSelected,
    isSelected,
    closeBulkProxyModal,
    applyProxyAssignments,
    handleApplySinglePool,
    handleApplyOneToOne,
  };
}

export type UseBulkProxyReturn = ReturnType<typeof useBulkProxy>;
