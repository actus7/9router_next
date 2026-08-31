"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getQuotaCache,
  QUOTA_CACHE_KEY,
  reconcileConnectionsPage,
  type Connection,
  type QuotaData,
} from "../utils";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import type { UseConnectionActionsReturn } from "../types";

export function useConnectionActions(
  fetchConnections: (targetPage?: number) => Promise<Connection[]>,
  fetchQuota: (connectionId: string, provider: string, opts?: { force?: boolean }) => Promise<void>,
  page: number,
  setQuotaData: React.Dispatch<React.SetStateAction<Record<string, QuotaData>>>,
  setLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>,
): UseConnectionActionsReturn {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [proxyPools, setProxyPools] = useState<Array<{ id: string; name: string }>>([]);
  const [bulkToggling, setBulkToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.proxyPools) {
          setProxyPools(data.proxyPools as Array<{ id: string; name: string }>);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDeleteConnection = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setLoading((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setErrors((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });

          if (typeof window !== "undefined") {
            try {
              const cache = getQuotaCache();
              if (cache[id]) {
                delete cache[id];
                window.localStorage.setItem(
                  QUOTA_CACHE_KEY,
                  JSON.stringify(cache),
                );
              }
            } catch (e) {
              console.error("Error deleting cache entry:", e);
            }
          }

          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error deleting connection:", error);
      } finally {
        setDeletingId(null);
      }
    },
    [fetchConnections, page, setQuotaData, setLoading, setErrors],
  );

  const handleToggleConnectionActive = useCallback(
    async (id: string, isActive: boolean) => {
      setTogglingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            return next;
          });
          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error updating connection status:", error);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchConnections, page, setQuotaData],
  );

  const handleUpdateConnection = useCallback(
    async (formData: Record<string, unknown>) => {
      if (!selectedConnection?.id) return;
      const connectionId = selectedConnection.id;
      const provider = selectedConnection.provider;
      try {
        const res = await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (res.ok) {
          await fetchConnections();
          setShowEditModal(false);
          setSelectedConnection(null);
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
            await fetchQuota(connectionId, provider);
          }
        }
      } catch (error) {
        console.error("Error saving connection:", error);
      }
    },
    [selectedConnection, fetchConnections, fetchQuota],
  );

  const bulkSetActive = useCallback(
    async (targetIds: string[], isActive: boolean) => {
      if (!targetIds.length || bulkToggling) return;
      setBulkToggling(true);
      try {
        await Promise.all(
          targetIds.map((id: string) =>
            fetch(`/api/providers/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive }),
            }),
          ),
        );
        await reconcileConnectionsPage(fetchConnections, page);
      } catch (error) {
        console.error("Error bulk toggling connections:", error);
      } finally {
        setBulkToggling(false);
      }
    },
    [bulkToggling, fetchConnections, page],
  );

  return {
    deletingId,
    setDeletingId,
    togglingId,
    setTogglingId,
    showEditModal,
    setShowEditModal,
    selectedConnection,
    setSelectedConnection,
    showDeleteConfirm,
    setShowDeleteConfirm,
    pendingDeleteId,
    setPendingDeleteId,
    proxyPools,
    bulkToggling,
    handleDeleteConnection,
    handleToggleConnectionActive,
    handleUpdateConnection,
    bulkSetActive,
  };
}
