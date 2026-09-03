import { Suspense } from "react";
import {
  getProviders,
  getProviderNodes,
  getProxyPoolsWithUsage,
  getSettings,
  getProviderModels,
  getAllDisabledModels,
  getModelAliases,
  getCustomModels,
} from "@/lib/data-access";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS } from "@/shared/constants/providers";
import { Spinner } from "@/shared/components/Loading";
import ProviderDetailClient from "./ProviderDetailClient";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { notFound } from "next/navigation";

async function ProviderDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await assertRequestRuntime();
  const { id } = await params;

  // Validate provider exists in constants (id is provider name like "kiro", not a UUID)
  const providerExists =
    id in OAUTH_PROVIDERS ||
    id in APIKEY_PROVIDERS ||
    id in FREE_PROVIDERS ||
    id in FREE_TIER_PROVIDERS ||
    id in WEB_COOKIE_PROVIDERS ||
    id.startsWith("oai-cc-") ||
    id.startsWith("ant-cc-");
  if (!providerExists) notFound();

  const [providers, nodes, pools, settings, models, disabledModels, aliases, customModels] =
    await Promise.all([
      getProviders(),
      getProviderNodes(),
      getProxyPoolsWithUsage(),
      getSettings(),
      getProviderModels(id),
      getAllDisabledModels(),
      getModelAliases(),
      getCustomModels(),
    ]);

  // Find the provider node for this provider
  const providerNode = nodes.find((n) => n.id === id) || null;

  return (
    <ProviderDetailClient
        providerId={id}
        initialProvider={providerNode as unknown as { id: string; name?: string; prefix?: string; apiType?: string; baseUrl?: string; type?: string; [key: string]: unknown } | null}
        initialProviders={providers as unknown as { id: string; name?: string; email?: string; displayName?: string; authType?: string; testStatus?: string; isActive?: boolean; lastError?: string; priority?: number; globalPriority?: number; provider?: string; providerSpecificData?: { proxyPoolId?: string; connectionProxyEnabled?: boolean; connectionProxyUrl?: string; connectionNoProxy?: string; [key: string]: unknown }; [key: string]: unknown }[]}
        initialNodes={nodes as unknown as { id: string; name?: string; prefix?: string; apiType?: string; baseUrl?: string; type?: string; [key: string]: unknown }[]}
        initialPools={pools as unknown as { id: string; name: string; proxyUrl?: string; noProxy?: string; isActive?: boolean }[]}
        initialSettings={settings}
        initialModels={models}
        initialDisabledModels={disabledModels}
        initialAliases={aliases}
        initialCustomModels={customModels as unknown as { id: string; providerAlias?: string; kind?: string; type?: string; [key: string]: unknown }[]}
    />
  );
}

export default function ProviderDetailPage(props: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ProviderDetailContent {...props} /></Suspense>;
}
