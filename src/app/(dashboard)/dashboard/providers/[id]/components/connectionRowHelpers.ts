"use client";

export interface ProxyInfo {
  boundProxyPoolId: string | null;
  boundProxyPool: { id: string; name: string; proxyUrl?: string; noProxy?: string; isActive?: boolean } | undefined;
  hasLegacyProxy: boolean;
  hasAnyProxy: boolean;
  proxyDisplayText: string;
  maskedProxyUrl: string;
  noProxyText: string;
  proxyBadgeVariant: "secondary" | "default" | "destructive";
  proxyBadgeClassName: string | undefined;
}

export function computeProxyInfo(
  connection: { providerSpecificData?: { proxyPoolId?: string; connectionProxyEnabled?: boolean; connectionProxyUrl?: string; connectionNoProxy?: string; [key: string]: unknown } },
  proxyPools?: Array<{ id: string; name: string; proxyUrl?: string; noProxy?: string; isActive?: boolean }>,
): ProxyInfo {
  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
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
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch { maskedProxyUrl = rawProxyUrl; }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";
  let proxyBadgeVariant: "secondary" | "default" | "destructive" = "secondary";
  let proxyBadgeClassName: string | undefined;
  if (boundProxyPool?.isActive === true) { proxyBadgeVariant = "default"; proxyBadgeClassName = "bg-success/10 text-success-foreground"; }
  else if (boundProxyPoolId || hasLegacyProxy) proxyBadgeVariant = "destructive";

  return { boundProxyPoolId, boundProxyPool, hasLegacyProxy, hasAnyProxy, proxyDisplayText, maskedProxyUrl, noProxyText, proxyBadgeVariant, proxyBadgeClassName };
}

import { resolveConnectionAuthType } from "@/shared/constants/providers";

export function computeDisplayName(
  connection: { name?: string; email?: string; displayName?: string; authType?: string },
  providerId: string,
): { displayName: string; secondaryDisplayName: string | null } {
  const rowAuthType = resolveConnectionAuthType(providerId, connection.authType);
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim() : null;
  return { displayName, secondaryDisplayName };
}
