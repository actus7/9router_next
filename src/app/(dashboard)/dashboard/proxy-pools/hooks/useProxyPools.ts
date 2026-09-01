"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import type { ProxyPool, ConfirmState } from "../types";
import { normalizeFormData } from "../types";

export function useProxyPools(initialProxyPools: ProxyPool[]) {
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>(initialProxyPools);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState<ProxyPool | null>(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthProgress, setHealthProgress] = useState({ current: 0, total: 0 });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const notify = useNotificationStore();

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.error("Error fetching proxy pools:", error);
    }
  }, []);

  const resetForm = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (proxyPool: ProxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    resetForm();
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const res = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool!.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchProxyPools();
        closeFormModal();
        notify.success(editingProxyPool ? (translate("Proxy pool updated") || "Proxy pool updated") : (translate("Proxy pool created") || "Proxy pool created"));
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      console.error("Error saving proxy pool:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool: ProxyPool) => {
    setConfirmState({
      title: translate("Delete Proxy Pool") || "Delete Proxy Pool",
      message: `${translate("Delete proxy pool") || "Delete proxy pool"} "${proxyPool.name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
          if (res.ok) {
            setProxyPools((prev) => prev.filter((item) => item.id !== proxyPool.id));
            notify.success(translate("Proxy pool deleted") || "Proxy pool deleted");
            return;
          }

          const data = await res.json();
          if (res.status === 409) {
            notify.warning(`${translate("Cannot delete:") || "Cannot delete:"} ${data.boundConnectionCount || 0} ${translate("connection(s) still using this pool.") || "connection(s) still using this pool."}`);
          } else {
            notify.error(data.error || (translate("Failed to delete proxy pool") || "Failed to delete proxy pool"));
          }
        } catch (error) {
          console.error("Error deleting proxy pool:", error);
          notify.error(translate("Failed to delete proxy pool") || "Failed to delete proxy pool");
        }
      }
    });
  };

  const handleTest = async (proxyPoolId: string) => {
    setTestingId(proxyPoolId);
    try {
      const res = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        notify.error(data.error || (translate("Failed to test proxy") || "Failed to test proxy"));
        return;
      }

      await fetchProxyPools();
      notify.success(data.ok ? (translate("Proxy test passed") || "Proxy test passed") : (translate("Proxy test failed") || "Proxy test failed"));
    } catch (error) {
      console.error("Error testing proxy pool:", error);
      notify.error(translate("Failed to test proxy") || "Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleActive = async (pool: ProxyPool) => {
    const next = !pool.isActive;
    setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: next } : p));
    try {
      const res = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
        notify.error(translate("Failed to update active state") || "Failed to update active state");
      }
    } catch (error) {
      console.error("Error toggling active:", error);
      setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
    }
  };

  const allSelected = proxyPools.length > 0 && selectedIds.length === proxyPools.length;
  const toggleSelect = (id: string) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : proxyPools.map((p) => p.id));
  const clearSelection = () => setSelectedIds([]);

  const bulkSetActive = async (isActive: boolean) => {
    const targets = selectedIds.length > 0 ? selectedIds : proxyPools.map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0; let failed = 0;
      for (const id of targets) {
        try {
          const res = await fetch(`/api/proxy-pools/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive }),
          });
          if (res.ok) ok += 1; else failed += 1;
        } catch { failed += 1; }
      }
      await fetchProxyPools();
      notify.success(`${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: translate("Delete Proxy Pools") || "Delete Proxy Pools",
      message: `${translate("Delete") || "Delete"} ${selectedIds.length} ${translate("proxy pool(s)?") || "proxy pool(s)?"}`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        try {
          let ok = 0; let blocked = 0; let failed = 0;
          for (const id of selectedIds) {
            try {
              const res = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" });
              if (res.ok) ok += 1;
              else if (res.status === 409) blocked += 1;
              else failed += 1;
            } catch { failed += 1; }
          }
          await fetchProxyPools();
          clearSelection();
          notify.success(`${translate("Deleted") || "Deleted"} ${ok}${blocked ? `, ${blocked} ${translate("bound") || "bound"}` : ""}${failed ? `, ${failed} ${translate("failed") || "failed"}` : ""}`);
        } finally {
          setBulkBusy(false);
        }
      }
    });
  };

  const handleHealthCheck = async () => {
    const targets = selectedIds.length > 0
      ? proxyPools.filter((p) => selectedIds.includes(p.id))
      : proxyPools;
    if (targets.length === 0) return;
    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });
    let alive = 0; const deadIds: string[] = [];
    let done = 0;
    const CONCURRENCY = 10;
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const pool = queue.shift();
        if (!pool) break;
        try {
          const res = await fetch(`/api/proxy-pools/${pool.id}/test`, { method: "POST" });
          const data = await res.json();
          if (res.ok && data.ok) alive += 1; else deadIds.push(pool.id);
        } catch {
          deadIds.push(pool.id);
        } finally {
          done += 1;
          setHealthProgress({ current: done, total: targets.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    await fetchProxyPools();
    setHealthChecking(false);
    setHealthProgress({ current: 0, total: 0 });

    if (deadIds.length > 0) {
      setConfirmState({
        title: translate("Deactivate Dead Proxies") || "Deactivate Dead Proxies",
        message: `${translate("Active:") || "Active:"} ${alive}, ${translate("Dead:") || "Dead:"} ${deadIds.length}.\n\n${translate("Deactivate") || "Deactivate"} ${deadIds.length} ${translate("dead proxies?") || "dead proxies?"}`,
        onConfirm: async () => {
          setConfirmState(null);
          setBulkBusy(true);
          try {
            for (const id of deadIds) {
              try {
                await fetch(`/api/proxy-pools/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ isActive: false }),
                });
              } catch {}
            }
            await fetchProxyPools();
            notify.success(`${translate("Deactivated") || "Deactivated"} ${deadIds.length} ${translate("dead proxies") || "dead proxies"}`);
          } finally {
            setBulkBusy(false);
          }
        }
      });
    } else {
      notify.success(`${translate("Health check completed.") || "Health check completed."} ${translate("Active:") || "Active:"} ${alive}, ${translate("Dead:") || "Dead:"} ${deadIds.length}`);
    }
  };

  // Cleanup selectedIds when pools change
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => proxyPools.some((p) => p.id === id)));
  }, [proxyPools]);

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools]
  );

  return {
    proxyPools, setProxyPools, showFormModal, setShowFormModal,
    editingProxyPool, formData, setFormData, saving, testingId,
    selectedIds, setSelectedIds, healthChecking, healthProgress,
    bulkBusy, confirmState, setConfirmState, activeCount,
    fetchProxyPools, openCreateModal, openEditModal, closeFormModal,
    handleSave, handleDelete, handleTest, handleToggleActive,
    allSelected, toggleSelect, toggleSelectAll, clearSelection,
    bulkSetActive, bulkDelete, handleHealthCheck,
  };
}
