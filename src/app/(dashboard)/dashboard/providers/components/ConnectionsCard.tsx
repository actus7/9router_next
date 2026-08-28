"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant, getStatusClassName } from "@/shared/utils/connectionStatus";
import { Card, Button, Modal, Select, EditConnectionModal, ConfirmModal } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp, Key, Loader2, Lock, Network, Pencil, Plus, Trash2 } from "lucide-react";

// ── CooldownTimer ──────────────────────────────────────────────
interface CooldownTimerProps {
  until: string;
}

function CooldownTimer({ until }: CooldownTimerProps) {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) { setRemaining(""); return; }
      const s = Math.floor(diff / 1000);
      if (s < 60) setRemaining(`${s}s`);
      else if (s < 3600) setRemaining(`${Math.floor(s / 60)}m ${s % 60}s`);
      else setRemaining(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [until]);

  if (!remaining) return null;
  return <span className="text-xs text-orange-500 font-mono">⏱ {remaining}</span>;
}

// ── ConnectionRow ──────────────────────────────────────────────
interface Connection {
  id: string;
  name?: string;
  email?: string;
  displayName?: string;
  testStatus?: string;
  isActive?: boolean;
  lastError?: string;
  priority?: number;
  provider?: string;
  providerSpecificData?: {
    proxyPoolId?: string;
    connectionProxyEnabled?: boolean;
    connectionProxyUrl?: string;
    connectionNoProxy?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ProxyPool {
  id: string;
  name: string;
  proxyUrl?: string;
  noProxy?: string;
  isActive?: boolean;
}

interface ConnectionRowProps {
  connection: Connection;
  proxyPools?: ProxyPool[];
  isOAuth: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: (isActive: boolean) => void;
  onUpdateProxy?: (proxyPoolId: string | null) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}

function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete }: ConnectionRowProps) {
  const [showProxyDropdown, setShowProxyDropdown] = useState<boolean>(false);
  const [updatingProxy, setUpdatingProxy] = useState<boolean>(false);
  const [isCooldown, setIsCooldown] = useState<boolean>(false);
  const proxyDropdownRef = useRef<HTMLDivElement>(null);

  const proxyPoolMap = new Map((proxyPools || []).map((p) => [p.id, p]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : undefined;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;

  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId ? `Pool: ${boundProxyPoolId} (inactive/missing)`
    : hasLegacyProxy ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}` : "";

  let maskedProxyUrl = "";
  const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
  if (rawProxyUrl) {
    try {
      const p = new URL(rawProxyUrl);
      maskedProxyUrl = `${p.protocol}//${p.hostname}${p.port ? `:${p.port}` : ""}`;
    } catch { maskedProxyUrl = rawProxyUrl; }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";
  const proxyBadgeVariant: "secondary" | "default" | "destructive" = boundProxyPool?.isActive === true ? "default" : (boundProxyPoolId || hasLegacyProxy) ? "destructive" : "secondary";
  const proxyBadgeClassName: string | undefined = boundProxyPool?.isActive === true ? "bg-green-500/10 text-green-600 dark:text-green-400" : undefined;

  const modelLockUntil: string | null = (Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v).filter((v): v is string => typeof v === 'string').sort()[0]) || null;

  useEffect(() => {
    const check = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v).filter((v): v is string => typeof v === 'string' && new Date(v).getTime() > Date.now()).sort()[0] || null;
      setIsCooldown(!!until);
    };
    check();
    const t = modelLockUntil ? setInterval(check, 1000) : null;
    return () => { if (t) clearInterval(t); };
  }, [modelLockUntil, connection]);

  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e: MouseEvent) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node))
        setShowProxyDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const effectiveStatus = connection.testStatus === "unavailable" && !isCooldown ? "active" : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus ?? "unknown");

  const displayName = isOAuth
    ? connection.name || connection.email || connection.displayName || "OAuth Account"
    : connection.name;

  const handleSelectProxy = async (poolId: string) => {
    setUpdatingProxy(true);
    try { await onUpdateProxy?.(poolId === "__none__" ? null : poolId); }
    finally { setUpdatingProxy(false); setShowProxyDropdown(false); }
  };

  return (
    <div className={`group flex flex-col gap-3 p-2 rounded-lg sm:flex-row sm:items-center sm:justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex w-full min-w-0 flex-1 items-start gap-3 sm:items-center">
        <div className="flex flex-col">
          <Button variant="ghost" size="icon-sm" onClick={onMoveUp} disabled={isFirst} className={isFirst ? "text-text-muted/30" : ""}>
            <ChevronUp className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onMoveDown} disabled={isLast} className={isLast ? "text-text-muted/30" : ""}>
            <ChevronDown className="size-4" />
          </Button>
        </div>
        <span className="text-base text-text-muted">{isOAuth ? <Lock className="size-4" /> : <Key className="size-4" />}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant={getStatusVariant()} className={getStatusClassName(connection.isActive, effectiveStatus ?? "unknown")}>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            {hasAnyProxy && <Badge variant={proxyBadgeVariant} className={proxyBadgeClassName}>Proxy</Badge>}
            {isCooldown && connection.isActive !== false && modelLockUntil && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="text-xs text-red-500 truncate max-w-[300px]" title={connection.lastError}>{connection.lastError}</span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-text-muted truncate max-w-[420px]" title={proxyDisplayText}>{proxyDisplayText}</span>
              {maskedProxyUrl && <code className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded text-text-muted">{maskedProxyUrl}</code>}
              {noProxyText && <span className="text-[11px] text-text-muted truncate max-w-[320px]" title={noProxyText}>no_proxy: {noProxyText}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="flex flex-wrap gap-1">
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <Button
                variant="ghost"
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex-col ${hasAnyProxy ? "text-primary" : ""}`}
                disabled={updatingProxy}
              >
                <span className="text-[18px]">{updatingProxy ? <Loader2 className="size-[18px] animate-spin" /> : <Network className="size-[18px]" />}</span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </Button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                  <Button variant="ghost" onClick={() => handleSelectProxy("__none__")} className={`w-full justify-start ${!boundProxyPoolId ? "text-primary font-medium" : ""}`}>None</Button>
                  {(proxyPools || []).map((pool) => (
                    <Button key={pool.id} variant="ghost" onClick={() => handleSelectProxy(pool.id)} className={`w-full justify-start ${boundProxyPoolId === pool.id ? "text-primary font-medium" : ""}`}>{pool.name}</Button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={onEdit} className="flex-col">
            <Pencil className="size-5" />
            <span className="text-[10px] leading-tight">Edit</span>
          </Button>
          <Button variant="destructive" onClick={onDelete} className="flex-col">
            <Trash2 className="size-5" />
            <span className="text-[10px] leading-tight">Delete</span>
          </Button>
        </div>
        <Switch checked={connection.isActive ?? true} onCheckedChange={onToggleActive} title={(connection.isActive ?? true) ? "Desabilitar" : "Habilitar"} />
      </div>
    </div>
  );
}

// ── AddApiKeyModal ─────────────────────────────────────────────
interface AddApiKeyModalProps {
  isOpen: boolean;
  provider?: string;
  providerName?: string;
  proxyPools?: ProxyPool[];
  onSave: (formData: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

function AddApiKeyModal({ isOpen, provider, providerName, proxyPools, onSave, onClose }: AddApiKeyModalProps) {
  const NONE = "__none__";
  const [formData, setFormData] = useState({ name: "", apiKey: "", priority: 1, proxyPoolId: NONE });
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<"success" | "failed" | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch { setValidationResult("failed"); }
    finally { setValidating(false); }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;
    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true); setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch { setValidationResult("failed"); }
      finally { setValidating(false); }
      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally { setSaving(false); }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} API Key`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <Label className="text-xs text-text-muted mb-1 block">Nome</Label>
          <Input className="w-full px-3 py-2 text-sm" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Production Key" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs text-text-muted mb-1 block">Chave de API</Label>
            <Input type="password" className="w-full px-3 py-2 text-sm" value={formData.apiKey} onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })} />
          </div>
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? "Verificando..." : "Verificar"}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "default" : "destructive"} className={validationResult === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400" : undefined}>
            {validationResult === "success" ? "Válido" : "Inválido"}
          </Badge>
        )}
        <div>
          <Label className="text-xs text-text-muted mb-1 block">Prioridade</Label>
          <Input type="number" className="w-full px-3 py-2 text-sm" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })} />
        </div>
        <Select label="Pool de Proxy" value={formData.proxyPoolId} onChange={(val: string) => setFormData({ ...formData, proxyPoolId: val })}
          options={[{ value: NONE, label: "Nenhum" }, ...(proxyPools || []).map((p) => ({ value: p.id, label: p.name }))]} />
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── ConnectionsCard ────────────────────────────────────────────
// Self-contained card: fetches, displays and manages all connections for a provider.
interface ConnectionsCardProps {
  providerId: string;
  isOAuth?: boolean;
}

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

export default function ConnectionsCard({ providerId, isOAuth }: ConnectionsCardProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
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
      if (connRes.ok) setConnections((connData.connections || []).filter((c: Connection) => c.provider === providerId));
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
      title: "Excluir Conexão",
      message: "Excluir esta conexão?",
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
      const res = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerId, ...formData }) });
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
          <h2 className="text-lg font-semibold">Conexões</h2>
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
            <p className="text-sm text-text-muted">Nenhuma conexão ainda</p>
            <Button icon={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>Adicionar Conexão</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
              {connections.map((conn, idx) => (
                <ConnectionRow
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
              <Button icon={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>Adicionar</Button>
            </div>
          </>
        )}
      </Card>

      <AddApiKeyModal
        isOpen={showAddModal}
        provider={providerId}
        proxyPools={proxyPools}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </>
  );
}
