"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";
import { CardSkeleton } from "@/shared/components";
import { Alert } from "@/components/ui/alert";
import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  getProviderAlias,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { useProviderConnections } from "./hooks/useProviderConnections";
import { useProviderModels } from "./hooks/useProviderModels";
import ConnectionsSection from "./sections/ConnectionsSection";
import ModelsSection from "./sections/ModelsSection";
import { ArrowLeft, ExternalLink, Info, TriangleAlert } from "lucide-react";
import type {
  Connection,
  CustomModelEntry,
  ProviderInfo,
  ProviderNode,
  ProxyPool,
} from "./types";

interface ProviderDetailClientProps {
  providerId: string;
  initialProvider: ProviderNode | null;
  initialProviders: Connection[];
  initialNodes: ProviderNode[];
  initialPools: ProxyPool[];
  initialSettings: Record<string, unknown>;
  initialModels: unknown[];
  initialDisabledModels: Record<string, string[]>;
  initialAliases: Record<string, string>;
  initialCustomModels: CustomModelEntry[];
}

export default function ProviderDetailClient({
  providerId,
  initialProvider,
  initialProviders,
  initialPools,
  initialSettings,
  initialModels: _initialModels,
  initialDisabledModels,
  initialAliases,
  initialCustomModels,
}: ProviderDetailClientProps) {
  const router = useRouter();
  const providerAlias = getProviderAlias(providerId);
  // Persisted connections may predate canonical IDs (`naga` instead of
  // `naga-ac`). Keep them visible and usable on their canonical provider page.
  const filteredConnections = initialProviders.filter((connection) => normalizeProviderId(connection.provider || "") === providerId);
  const [headerImgError, setHeaderImgError] = useState<boolean>(false);

  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;

  const connectionsHook = useProviderConnections({
    providerId,
    initialConnections: filteredConnections,
    initialProvider,
    initialPools,
    initialSettings,
    isCompatible,
  });

  const providerInfo: ProviderInfo | undefined = connectionsHook.providerNode
    ? {
        id: connectionsHook.providerNode.id,
        name: connectionsHook.providerNode.name || (connectionsHook.providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: connectionsHook.providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: connectionsHook.providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: connectionsHook.providerNode.apiType,
        baseUrl: connectionsHook.providerNode.baseUrl,
        type: connectionsHook.providerNode.type,
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]) as ProviderInfo | undefined;
  const authModes: string[] = (providerInfo?.authModes as string[] | undefined) || [];
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!providerInfo?.hasOAuth || authModes.includes("oauth");
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const isFreeNoAuth = !!(FREE_PROVIDERS[providerId] as Record<string, unknown>)?.noAuth;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  const oauthConnectionLabel =
    providerId === "xai" ? "Grok Build OAuth"
    : providerId === "grok-cli" ? "Grok CLI Device Login"
    : providerId === "kimi" ? "Kimi Coding OAuth"
    : "OAuth";
  const apiKeyConnectionLabel =
    providerId === "xai" ? "xAI API Key"
    : providerId === "kimi" ? "Kimi API Key"
    : providerId === "qoder" ? "PAT"
    : "API Key";
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible
    ? ((connectionsHook.providerNode as Record<string, unknown>)?.prefix as string || providerId)
    : providerAlias;

  const modelsHook = useProviderModels({
    providerId,
    providerStorageAlias,
    providerAlias,
    isCompatible,
    isAnthropicCompatible,
    connections: connectionsHook.connections,
    providerNode: connectionsHook.providerNode,
    initialAliases,
    initialCustomModels,
    initialDisabledModels,
  });

  if (connectionsHook.loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">{translate("Provider not found")}</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">
          {translate("Back to Providers")}
        </Link>
      </div>
    );
  }

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png";
    }
    return getProviderIconSrc(providerInfo.id);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 pb-6 sm:gap-5 sm:px-0">
      {/* Header */}
      <div className="min-w-0 px-1 py-1 sm:px-0">
        <Link
          href="/dashboard/providers"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          {translate("Back to Providers")}
        </Link>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-white/10"
            style={{ backgroundColor: `${providerInfo.color}15` }}
          >
            {headerImgError || !getHeaderIconPath() ? (
              <span className="text-sm font-bold" style={{ color: providerInfo.color }}>
                {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image
                src={getHeaderIconPath() || ""}
                alt={providerInfo.name}
                width={44}
                height={44}
                className="max-h-11 max-w-11 rounded-lg object-contain"
                sizes="44px"
                onError={() => {
                  markProviderIconMissing(providerInfo.id);
                  setHeaderImgError(true);
                }}
              loading="lazy"
              decoding="async"
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{providerInfo.name}</h1>
              {(providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website) && (
                <a
                  href={providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="size-4" />
                  {providerInfo.notice?.apiKeyUrl ? "Get API Key" : "Sign up / Learn more"}
                </a>
              )}
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {connectionsHook.connections.length} connection{connectionsHook.connections.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      {providerInfo.deprecated && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <Alert className="border-blue-500/25 bg-blue-500/[0.08] px-4 py-3 text-blue-700 dark:text-blue-300">
          <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400 sm:mt-0" />
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-blue-700 dark:text-blue-300">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 justify-center rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
            >
              Get API Key →
            </a>
          )}
        </Alert>
      )}

      <ConnectionsSection
        providerId={providerId}
        providerInfo={providerInfo}
        connectionsHook={connectionsHook}
        isCompatible={isCompatible}
        isAnthropicCompatible={isAnthropicCompatible}
        isFreeNoAuth={isFreeNoAuth}
        isOAuth={isOAuth}
        hasDualAuthModes={hasDualAuthModes}
        oauthConnectionLabel={oauthConnectionLabel}
        apiKeyConnectionLabel={apiKeyConnectionLabel}
        router={router}
      />

      <ModelsSection
        providerId={providerId}
        providerStorageAlias={providerStorageAlias}
        providerDisplayAlias={providerDisplayAlias}
        isCompatible={isCompatible}
        isAnthropicCompatible={isAnthropicCompatible}
        isFreeNoAuth={isFreeNoAuth}
        connections={connectionsHook.connections}
        thinkingMode={connectionsHook.thinkingMode}
        onThinkingModeChange={connectionsHook.handleThinkingModeChange}
        noModelDiscovery={!!providerInfo?.noModelDiscovery}
        modelsHook={modelsHook}
      />
    </div>
  );
}
