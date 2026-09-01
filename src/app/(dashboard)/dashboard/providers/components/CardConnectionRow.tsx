"use client";

import { useState, useRef, useEffect } from "react";
import { getStatusVariant as getConnectionStatusVariant, getStatusClassName } from "@/shared/utils/connectionStatus";
import { Button } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronUp, Key, Loader2, Lock, Network, Pencil, Trash2 } from "lucide-react";
import { translate } from "@/i18n/runtime";

export interface CardConnection {
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

export interface CardProxyPool {
  id: string;
  name: string;
  proxyUrl?: string;
  noProxy?: string;
  isActive?: boolean;
}

interface CardConnectionRowProps {
  connection: CardConnection;
  proxyPools?: CardProxyPool[];
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

export default function CardConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete }: CardConnectionRowProps) {
  const [showProxyDropdown, setShowProxyDropdown] = useState<boolean>(false);
  const [updatingProxy, setUpdatingProxy] = useState<boolean>(false);
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

  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e: MouseEvent) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node))
        setShowProxyDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const effectiveStatus = connection.testStatus;
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
              <Button variant="ghost" onClick={() => setShowProxyDropdown((v) => !v)} className={`flex-col ${hasAnyProxy ? "text-primary" : ""}`} disabled={updatingProxy}>
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
        <Switch checked={connection.isActive ?? true} onCheckedChange={onToggleActive} title={((connection.isActive ?? true) ? translate("Disable") : translate("Enable")) ?? undefined} />
      </div>
    </div>
  );
}
