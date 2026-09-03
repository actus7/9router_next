"use client";

import { getStatusVariant as getConnectionStatusVariant, getStatusClassName } from "@/shared/utils/connectionStatus";
import { resolveConnectionAuthType } from "@/shared/constants/providers";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import CooldownTimer from "./CooldownTimer";

interface ConnectionBadgesProps {
  connection: {
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
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  providerId: string;
  oneByOneStatus?: { state: string; error?: string | null } | null;
  hasAnyProxy: boolean;
  proxyBadgeVariant: "secondary" | "default" | "destructive";
  proxyBadgeClassName?: string;
  effectiveStatus?: string;
  isCooldown?: boolean;
  modelLockUntil?: string | null;
}

export default function ConnectionBadges({
  connection,
  providerId,
  oneByOneStatus = null,
  hasAnyProxy,
  proxyBadgeVariant,
  proxyBadgeClassName,
  effectiveStatus,
  isCooldown = false,
  modelLockUntil = null,
}: ConnectionBadgesProps) {
  const rowAuthType = resolveConnectionAuthType(providerId, connection.authType);
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus ?? "");

  const getOneByOneVariant = (): "secondary" | "default" | "destructive" => {
    if (!oneByOneStatus) return "secondary";
    if (oneByOneStatus.state === "success") return "default";
    if (oneByOneStatus.state === "failed") return "destructive";
    if (oneByOneStatus.state === "testing") return "default";
    return "secondary";
  };

  const getOneByOneClassName = (): string | undefined => {
    if (!oneByOneStatus) return undefined;
    if (oneByOneStatus.state === "success") return "bg-success text-success-foreground dark:text-success-foreground";
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
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
      <Badge variant={getStatusVariant()} className={getStatusClassName(connection.isActive, effectiveStatus ?? "")}>
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
      {isCooldown && connection.isActive !== false && modelLockUntil && <CooldownTimer until={modelLockUntil} />}
      {connection.lastError && connection.isActive !== false && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Badge variant="destructive">Last test failed</Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-words">{connection.lastError}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
  );
}
