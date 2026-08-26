"use client";

import { useState, useEffect, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant, getStatusClassName } from "@/shared/utils/connectionStatus";
import {  } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import Button from "@/shared/components/Button";
import CooldownTimer from "./CooldownTimer";

interface Connection {
  id: string;
  name?: string;
  email?: string;
  displayName?: string;
  authType?: string;
  testStatus?: string;
  isActive?: boolean;
  lastError?: string;
  priority?: number;
  globalPriority?: number;
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

interface AutoPingConfig {
  on: boolean;
  onToggle: (on: boolean) => void;
  provider: string;
}

interface OneByOneStatus {
  state: string;
  error?: string | null;
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
  oneByOneStatus?: OneByOneStatus | null;
  autoPing?: AutoPingConfig | null;
}

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null }: ConnectionRowProps) {
  const [showProxyDropdown, setShowProxyDropdown] = useState<boolean>(false);
  const [updatingProxy, setUpdatingProxy] = useState<boolean>(false);
  const proxyDropdownRef = useRef<HTMLDivElement>(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : undefined;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl!);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl!;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant: "secondary" | "default" | "destructive" = "secondary";
  let proxyBadgeClassName: string | undefined;
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "default";
    proxyBadgeClassName = "bg-green-500/10 text-green-600 dark:text-green-400";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "destructive";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e: MouseEvent) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId: string) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy?.(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState<boolean>(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter((v): v is string => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter((v): v is string => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil, connection]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired → treat as active
    : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = (): "secondary" | "default" | "destructive" => {
    if (!oneByOneStatus) return "secondary";
    if (oneByOneStatus.state === "success") return "default";
    if (oneByOneStatus.state === "failed") return "destructive";
    if (oneByOneStatus.state === "testing") return "default";
    return "secondary";
  };

  const getOneByOneClassName = (): string | undefined => {
    if (!oneByOneStatus) return undefined;
    if (oneByOneStatus.state === "success") return "bg-green-500/10 text-green-600 dark:text-green-400";
    if (oneByOneStatus.state === "testing") return undefined;
    return undefined;
  };

  const getOneByOneLabel = (): string | null => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  return (
    <div className={`group flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
        {/* Priority arrows */}
        <div className="flex shrink-0 flex-col">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onMoveUp}
            disabled={isFirst}
            className={isFirst ? "text-text-muted/30" : ""}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onMoveDown}
            disabled={isLast}
            className={isLast ? "text-text-muted/30" : ""}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </Button>
        </div>
        <span className="material-symbols-outlined shrink-0 text-base text-text-muted">
          {authIcon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {secondaryDisplayName && (
            <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} className={getStatusClassName(connection.isActive, effectiveStatus)}>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            <Badge variant="secondary">
              {authLabel}
            </Badge>
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} className={proxyBadgeClassName}>
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil!} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="max-w-full truncate text-xs text-red-500 sm:max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
            {getOneByOneLabel() && (
              <Badge variant={getOneByOneVariant()} className={getOneByOneClassName()}>
                {getOneByOneLabel()}
              </Badge>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]" title={noProxyText}>
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
          {/* Proxy button with inline dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <Button
                variant="ghost"
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`w-full flex-col ${hasAnyProxy ? "text-primary" : ""}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </Button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <Button
                    variant="ghost"
                    onClick={() => handleSelectProxy("__none__")}
                    className={`w-full justify-start ${!boundProxyPoolId ? "text-primary font-medium" : ""}`}
                  >
                    None
                  </Button>
                  {(proxyPools || []).map((pool) => (
                    <Button
                      key={pool.id}
                      variant="ghost"
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`w-full justify-start ${boundProxyPoolId === pool.id ? "text-primary font-medium" : ""}`}
                    >
                      {pool.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {autoPing && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button
                    variant="ghost"
                    onClick={() => autoPing.onToggle(!autoPing.on)}
                    className={`w-full flex-col ${autoPing.on ? "text-primary" : ""}`}
                  >
                    <span className="material-symbols-outlined text-[18px]">bolt</span>
                    <span className="text-[10px] leading-tight">Auto-ping</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{autoPingTooltip}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button variant="ghost" onClick={onEdit} className="flex-col">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </Button>
          <Button variant="destructive" onClick={onDelete} className="flex-col">
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-[10px] leading-tight">Delete</span>
          </Button>
        </div>
        <Switch
          checked={connection.isActive ?? true}
          onCheckedChange={onToggleActive}
        />
      </div>
    </div>
  );
}
