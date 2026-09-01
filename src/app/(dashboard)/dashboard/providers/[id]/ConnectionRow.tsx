"use client";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Key, Lock, Zap } from "lucide-react";
import ConnectionBadges from "./components/ConnectionBadges";
import ProxyDropdown from "./components/ProxyDropdown";
import ConnectionActions from "./components/ConnectionActions";
import { computeProxyInfo, computeDisplayName } from "./components/connectionRowHelpers";

interface Connection {
  id: string; name?: string; email?: string; displayName?: string; authType?: string;
  testStatus?: string; isActive?: boolean; lastError?: string; priority?: number; globalPriority?: number;
  providerSpecificData?: { proxyPoolId?: string; connectionProxyEnabled?: boolean; connectionProxyUrl?: string; connectionNoProxy?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface ProxyPool { id: string; name: string; proxyUrl?: string; noProxy?: string; isActive?: boolean; }
interface AutoPingConfig { on: boolean; onToggle: (on: boolean) => void; provider: string; }
interface OneByOneStatus { state: string; error?: string | null; }

interface ConnectionRowProps {
  connection: Connection; proxyPools?: ProxyPool[]; isOAuth: boolean; isFirst: boolean; isLast: boolean;
  onMoveUp: () => void; onMoveDown: () => void; onToggleActive: (isActive: boolean) => void;
  onUpdateProxy?: (proxyPoolId: string | null) => Promise<void>; onEdit: () => void; onDelete: () => void;
  oneByOneStatus?: OneByOneStatus | null; autoPing?: AutoPingConfig | null;
}

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null }: ConnectionRowProps) {
  const proxy = computeProxyInfo(connection, proxyPools);
  const { displayName, secondaryDisplayName } = computeDisplayName(connection, isOAuth);
  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isCookieConnection = rowAuthType === "cookie";
  const isOAuthConnection = rowAuthType === "oauth";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  return (
    <div className={`group flex min-w-0 flex-col gap-3 rounded-xl border border-transparent px-2 py-2.5 transition-colors hover:border-border-subtle hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-xs" onClick={onMoveUp} disabled={isFirst} className={isFirst ? "text-text-muted/30" : ""}><ChevronUp className="size-4" /></Button>
          <Button variant="ghost" size="icon-xs" onClick={onMoveDown} disabled={isLast} className={isLast ? "text-text-muted/30" : ""}><ChevronDown className="size-4" /></Button>
        </div>
        <span className="shrink-0 text-base text-text-muted">{isCookieConnection ? "cookie" : isOAuthConnection ? <Lock className="size-4" /> : <Key className="size-4" />}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {secondaryDisplayName && <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>}
          <ConnectionBadges connection={connection} isOAuth={isOAuth} oneByOneStatus={oneByOneStatus} hasAnyProxy={proxy.hasAnyProxy} proxyBadgeVariant={proxy.proxyBadgeVariant} proxyBadgeClassName={proxy.proxyBadgeClassName} />
          {proxy.hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]" title={proxy.proxyDisplayText}>{proxy.proxyDisplayText}</span>
              {proxy.maskedProxyUrl && <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">{proxy.maskedProxyUrl}</code>}
              {proxy.noProxyText && <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]" title={proxy.noProxyText}>no_proxy: {proxy.noProxyText}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
          <ProxyDropdown proxyPools={proxyPools || []} boundProxyPoolId={proxy.boundProxyPoolId} hasAnyProxy={proxy.hasAnyProxy} onUpdateProxy={onUpdateProxy} />
          {autoPing && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button variant="ghost" onClick={() => autoPing.onToggle(!autoPing.on)} className={`w-full flex-col ${autoPing.on ? "text-primary" : ""}`}>
                    <Zap className="size-5" /><span className="text-[10px] leading-tight">Auto-ping</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{autoPingTooltip}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <ConnectionActions onEdit={onEdit} onDelete={onDelete} />
        </div>
        <Switch checked={connection.isActive ?? true} onCheckedChange={onToggleActive} />
      </div>
    </div>
  );
}
