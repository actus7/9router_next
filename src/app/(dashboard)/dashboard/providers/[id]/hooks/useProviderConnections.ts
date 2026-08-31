"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import type {
  AutoPingConfig,
  Connection,
  ConfirmState,
  OneByOneResult,
  OneByOneSummary,
  ProviderNode,
  ProxyPool,
} from "../types";

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

const ONE_BY_ONE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UseProviderConnectionsArgs {
  providerId: string;
  initialConnections: Connection[];
  initialProvider: ProviderNode | null;
  initialPools: ProxyPool[];
  initialSettings: Record<string, unknown>;
  isCompatible: boolean;
}

// Owns everything about this provider's connections: the list itself, add/edit/OAuth flows,
// priority ordering, bulk delete, bulk proxy assignment, auto-ping, one-by-one testing, and the
// per-provider strategy/thinking/auto-ping settings that are fetched together with the
// connections list via a single combined API round trip (see fetchConnections below).
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
  const [showOAuthModal, setShowOAuthModal] = useState<boolean>(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState<boolean>(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState<boolean>(false);
  const [addConnectionError, setAddConnectionError] = useState<string>("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState<boolean>(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState<boolean>(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState<boolean>(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState<boolean>(false);

  const settingsOverride = ((initialSettings.providerStrategies as Record<string, Record<string, unknown>>) || {})[providerId] || {};
  const thinkingCfg = ((initialSettings.providerThinking as Record<string, Record<string, unknown>>) || {})[providerId] || {};
  const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
  const apCfg = autoPingSettingsKey ? ((initialSettings[autoPingSettingsKey] as Record<string, unknown>) || {}) : {};

  const [providerStrategy, setProviderStrategy] = useState<string | null>((settingsOverride.fallbackStrategy as string) || null);
  const [providerStickyLimit, setProviderStickyLimit] = useState<string>(settingsOverride.stickyRoundRobinLimit != null ? String(settingsOverride.stickyRoundRobinLimit) : "1");
  const [thinkingMode, setThinkingMode] = useState<string>((thinkingCfg.mode as string) || "auto");
  const [autoPing, setAutoPing] = useState<AutoPingConfig>({ enabled: apCfg.enabled === true, connections: (apCfg.connections as Record<string, boolean>) || {} });

  const [oneByOneRunning, setOneByOneRunning] = useState<boolean>(false);
  const [oneByOneStopping, setOneByOneStopping] = useState<boolean>(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState<string | null>(null);
  const [oneByOneResults, setOneByOneResults] = useState<Record<string, OneByOneResult>>({});
  const [oneByOneSummary, setOneByOneSummary] = useState<OneByOneSummary | null>(null);
  const stopOneByOneRef = useRef<boolean>(false);

  const hasAutoPing = !!AUTO_PING_SETTINGS_KEYS[providerId];

  const openOAuthConnection = () => {
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = (isOAuth: boolean) => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed = window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) {
        setShowAgRiskModal(true);
        return;
      }
    }
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => {
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerAddConnection = (isOAuth: boolean) => {
    if (isOAuth) {
      triggerOAuthConnection(isOAuth);
      return;
    }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = (isOAuth: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

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
      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }
      // Load per-provider strategy override
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
      // Load per-provider thinking config
      const thinkingCfg = (settingsData.providerThinking || {})[providerId] || {};
      setThinkingMode(thinkingCfg.mode || "auto");
      const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
      const apCfg = autoPingSettingsKey ? settingsData[autoPingSettingsKey] || {} : {};
      setAutoPing({ enabled: apCfg.enabled === true, connections: apCfg.connections || {} });
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry: ProviderNode) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
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
    } catch (error) {
      console.error("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData: Record<string, string>) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.error("Error updating provider node:", error);
    }
  };

  const saveProviderStrategy = async (strategy: string | null, stickyLimit: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      const override: Record<string, unknown> = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.error("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled: boolean) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value: string) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const saveThinkingConfig = async (mode: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.error("Error saving thinking config:", error);
    }
  };

  const handleThinkingModeChange = (mode: string) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode);
  };

  const saveAutoPing = async (next: AutoPingConfig) => {
    const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
    if (!autoPingSettingsKey) return;

    setAutoPing(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [autoPingSettingsKey]: next }),
      });
    } catch (error) {
      console.error("Error saving auto-ping config:", error);
    }
  };

  const handleAutoPingConnection = (connectionId: string, on: boolean) => {
    saveAutoPing({ ...autoPing, connections: { ...autoPing.connections, [connectionId]: on } });
  };


  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;

    const queuedState = Object.fromEntries(
      connections.map((connection) => [connection.id, { state: "queued", error: null }]),
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });

    let passed = 0;
    let failed = 0;

    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: connections.length,
            completed: index,
            passed,
            failed,
            stopped: true,
          });
          break;
        }

        const connection = connections[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null },
        }));

        try {
          const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
          const data = await res.json();
          const valid = !!data.valid;

          if (valid) {
            passed += 1;
          } else {
            failed += 1;
          }

          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: valid ? "success" : "failed",
              error: valid ? null : (data.error || null),
            },
          }));
        } catch (error: unknown) {
          failed += 1;
          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: "failed",
              error: error instanceof Error ? error.message : "Test failed",
            },
          }));
        }

        setOneByOneSummary({
          total: connections.length,
          completed: index + 1,
          passed,
          failed,
          stopped: false,
        });

        if (index < connections.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      setOneByOneCurrentConnectionId(null);
      setOneByOneRunning(false);
      setOneByOneStopping(false);
      stopOneByOneRef.current = false;
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  const handleDelete = async (id: string) => {
    setConfirmState({
      title: translate("Delete connection") || "Delete connection",
      message: translate("Delete this connection?") || "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) {
            setConnections(prev => prev.filter(c => c.id !== id));
          }
        } catch (error) {
          console.error("Error deleting connection:", error);
        }
      }
    });
  };

  const handleBulkDelete = () => {
    const count = selectedConnectionIds.length;
    if (count === 0) return;
    setConfirmState({
      title: translate("Delete") + ` ${count} ` + translate("Connection(s)") || `Delete ${count} connection(s)`,
      message: translate("Delete") + ` ${count} ` + translate("connection(s)") + "? " + translate("This cannot be undone.") || `Delete ${count} connection(s)? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        let failed = 0;
        const idsToDelete = [...selectedConnectionIds];
        for (const id of idsToDelete) {
          try {
            const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
            if (!res.ok) failed += 1;
          } catch (error) {
            console.error("Error deleting connection:", error);
            failed += 1;
          }
        }
        setConnections(prev => prev.filter(c => !idsToDelete.includes(c.id)));
        setSelectedConnectionIds([]);
        if (failed > 0) notify.warning(translate("Deleted") + ` ${idsToDelete.length - failed} ` + translate("connection(s)") + `, ${failed} ` + translate("failed") + ".");
      }
    });
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleSaveApiKey = async (formData: Record<string, unknown>) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, providerId, ...formData }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || translate("Failed to save connection") || "Failed to save connection");
    } catch (error) {
      console.error("Error saving connection:", error);
      setAddConnectionError(translate("Failed to save connection") || "Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.error("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    }
  };

  const handleSwapPriority = async (index1: number, index2: number) => {
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
    setConnections(newConnections);

    try {
      await Promise.all([
        fetch(`/api/providers/${newConnections[index1].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index1 }),
        }),
        fetch(`/api/providers/${newConnections[index2].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index2 }),
        }),
      ]);
    } catch (error) {
      console.error("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  useEffect(() => {
    setSelectedConnectionIds((prev) => prev.filter((id) => connections.some((conn) => conn.id === id)));
  }, [connections]);

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

  // ponytail: bulk proxy assignment applies to all connections, not just the
  // checkbox selection used by Delete Selected. Pre-existing behavior, not a
  // regression introduced by this refactor.
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

  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;
  const isSelected = (connectionId: string) => selectedConnectionIds.includes(connectionId);

  return {
    connections,
    setConnections,
    showOptionalKeySection,
    setShowOptionalKeySection,
    loading,
    providerNode,
    proxyPools,
    showOAuthModal,
    setShowOAuthModal,
    showIFlowCookieModal,
    setShowIFlowCookieModal,
    showAddApiKeyModal,
    setShowAddApiKeyModal,
    addConnectionError,
    setAddConnectionError,
    showBulkImportCodex,
    setShowBulkImportCodex,
    showEditModal,
    setShowEditModal,
    showEditNodeModal,
    setShowEditNodeModal,
    showBulkProxyModal,
    setShowBulkProxyModal,
    selectedConnection,
    setSelectedConnection,
    selectedConnectionIds,
    setSelectedConnectionIds,
    bulkUpdatingProxy,
    confirmState,
    setConfirmState,
    showAgRiskModal,
    setShowAgRiskModal,
    providerStrategy,
    providerStickyLimit,
    thinkingMode,
    autoPing,
    hasAutoPing,
    oneByOneRunning,
    oneByOneStopping,
    oneByOneCurrentConnectionId,
    oneByOneResults,
    oneByOneSummary,
    allSelected,
    isSelected,
    openOAuthConnection,
    triggerOAuthConnection,
    triggerApiKeyConnection,
    triggerAddConnection,
    handleAgRiskConfirm,
    fetchConnections,
    handleUpdateNode,
    handleRoundRobinToggle,
    handleStickyLimitChange,
    handleThinkingModeChange,
    handleAutoPingConnection,
    handleRunOneByOneTest,
    handleStopOneByOneTest,
    handleDelete,
    handleBulkDelete,
    handleOAuthSuccess,
    handleIFlowCookieSuccess,
    handleSaveApiKey,
    handleUpdateConnection,
    handleUpdateConnectionStatus,
    handleSwapPriority,
    closeBulkProxyModal,
    applyProxyAssignments,
    handleApplySinglePool,
    handleApplyOneToOne,
  };
}

export { AUTO_PING_SETTINGS_KEYS };
export type UseProviderConnectionsReturn = ReturnType<typeof useProviderConnections>;
