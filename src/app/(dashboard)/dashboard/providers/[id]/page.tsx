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
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers";
import { Spinner } from "@/shared/components/Loading";
import ProviderDetailClient from "./ProviderDetailClient";
import { notFound } from "next/navigation";

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Validate provider exists in constants (id is provider name like "kiro", not a UUID)
  const providerExists =
    id in OAUTH_PROVIDERS ||
    id in APIKEY_PROVIDERS ||
    id in FREE_PROVIDERS ||
    id in FREE_TIER_PROVIDERS ||
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-10">
          <Spinner size="lg" />
        </div>
      }
    >
      <ProviderDetailClient
        providerId={id}
        initialProvider={providerNode}
        initialProviders={providers}
        initialNodes={nodes}
        initialPools={pools}
        initialSettings={settings}
        initialModels={models}
        initialDisabledModels={disabledModels}
        initialAliases={aliases}
        initialCustomModels={customModels}
      />
    </Suspense>
  );
}
