"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CardSkeleton } from "@/shared/components";
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
import ProviderHeader from "./components/ProviderHeader";
import ProviderAlerts from "./components/ProviderAlerts";
import type {
  CustomModelEntry,
  ProviderInfo,
  ProviderNode,
  ProxyPool,
  Connection,
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

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 pb-6 sm:gap-5 sm:px-0">
      <ProviderHeader
        providerInfo={providerInfo}
        connectionCount={connectionsHook.connections.length}
        isOpenAICompatible={isOpenAICompatible}
        isAnthropicCompatible={isAnthropicCompatible}
        headerImgError={headerImgError}
        setHeaderImgError={setHeaderImgError}
      />

      <ProviderAlerts providerInfo={providerInfo} />

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
