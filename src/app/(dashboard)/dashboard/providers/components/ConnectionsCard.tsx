"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, EditConnectionModal, ConfirmModal } from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { translate } from "@/i18n/runtime";
import CardConnectionRow, { type CardConnection, type CardProxyPool } from "./CardConnectionRow";
import CardAddApiKeyModal from "./CardAddApiKeyModal";

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

export default function ConnectionsCard({ providerId, isOAuth }: { providerId: string; isOAuth?: boolean }) {
  const [connections, setConnections] = useState<CardConnection[]>([]);
  const [proxyPools, setProxyPools] = useState<CardProxyPool[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [selectedConnection, setSelectedConnection] = useState<CardConnection | null>(null);
  const [providerStrategy, setProviderStrategy] = useState<string | null>(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState<string>("1");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const [connRes, proxyRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connData = await connRes.json();
      const proxyData = await proxyRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connRes.ok) setConnections((connData.connections || []).filter((c: CardConnection) => c.provider === providerId));
      if (proxyRes.ok) setProxyPools(proxyData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
    } catch (e) { console.error("ConnectionsCard fetch error:", e); }
    finally { setLoading(false); }
  }, [providerId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const saveStrategy = async (strategy: string | null, stickyLimit: string) => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override: Record<string, unknown> = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
    } catch (e) { console.error("saveStrategy error:", e); }
  };

  const handleSwapPriority = async (i1: number, i2: number) => {
    const next = [...connections];
    [next[i1], next[i2]] = [next[i2], next[i1]];
    setConnections(next);
    try {
      await Promise.all([
        fetch(`/api/providers/${next[i1].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: i1 }) }),
        fetch(`/api/providers/${next[i2].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: i2 }) }),
      ]);
    } catch { await fetch_(); }
  };

  const handleDelete = async (id: string) => {
    setConfirmState({
      title: translate("Delete connection") || "Delete connection",
      message: translate("Delete this connection?") || "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id));
        } catch (e) { console.error("delete error:", e); }
      }
    });
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === id ? { ...c, isActive } : c));
    } catch (e) { console.error("toggle error:", e); }
  };

  const handleUpdateProxy = async (connId: string, proxyPoolId: string | null) => {
    try {
      const res = await fetch(`/api/providers/${connId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId: proxyPoolId || null }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === connId ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId ?? undefined } } : c));
    } catch (e) { console.error("proxy error:", e); }
  };

  const handleSaveApiKey = async (formData: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerId, providerId, ...formData }) });
      if (res.ok) { await fetch_(); setShowAddModal(false); }
    } catch (e) { console.error("save apikey error:", e); }
  };

  const handleUpdateConnection = async (formData: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection!.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (res.ok) { await fetch_(); setShowEditModal(false); }
    } catch (e) { console.error("update connection error:", e); }
  };

  if (loading) return <Card><div className="h-20 animate-pulse bg-black/5 rounded-lg" /></Card>;

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-semibold">{translate("Connections")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted font-medium">Round Robin</span>
            <Switch
              checked={providerStrategy === "round-robin"}
              onCheckedChange={(enabled: boolean) => {
                const strategy = enabled ? "round-robin" : null;
                setProviderStrategy(strategy);
                if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
                saveStrategy(strategy, enabled ? (providerStickyLimit || "1") : providerStickyLimit);
              }}
            />
            {providerStrategy === "round-robin" && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted">Sticky:</span>
                <Input
                  type="number" min={1} value={providerStickyLimit}
                  onChange={(e) => { setProviderStickyLimit(e.target.value); saveStrategy("round-robin", e.target.value); }}
                  className="w-16 px-2 py-1 text-xs"
                />
              </div>
            )}
          </div>
        </div>

        {connections.length === 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">{translate("No connections yet")}</p>
            <Button icon={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>{translate("Add Connection")}</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
              {connections.map((conn, idx) => (
                <CardConnectionRow
                  key={conn.id}
                  connection={conn}
                  proxyPools={proxyPools}
                  isOAuth={!!isOAuth}
                  isFirst={idx === 0}
                  isLast={idx === connections.length - 1}
                  onMoveUp={() => handleSwapPriority(idx, idx - 1)}
                  onMoveDown={() => handleSwapPriority(idx, idx + 1)}
                  onToggleActive={(isActive) => handleToggleActive(conn.id, isActive)}
                  onUpdateProxy={(poolId) => handleUpdateProxy(conn.id, poolId)}
                  onEdit={() => { setSelectedConnection(conn); setShowEditModal(true); }}
                  onDelete={() => handleDelete(conn.id)}
                />
              ))}
            </div>
            <div className="mt-4 flex justify-stretch sm:justify-start">
              <Button icon={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>{translate("Add")}</Button>
            </div>
          </>
        )}
      </Card>

      <CardAddApiKeyModal isOpen={showAddModal} provider={providerId} proxyPools={proxyPools} onSave={handleSaveApiKey} onClose={() => setShowAddModal(false)} />
      <EditConnectionModal isOpen={showEditModal} connection={selectedConnection} onSave={handleUpdateConnection} onClose={() => setShowEditModal(false)} />
      <ConfirmModal isOpen={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={confirmState?.onConfirm ?? (() => {})} title={confirmState?.title || "Confirm"} message={confirmState?.message} variant="danger" />
    </>
  );
}
