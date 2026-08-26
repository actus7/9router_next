import { Suspense } from "react";
import {
  getProviderById,
  getProviders,
  getProviderNodes,
  getProxyPoolsWithUsage,
  getSettings,
  getProviderModels,
  getAllDisabledModels,
  getModelAliases,
  getCustomModels,
} from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import ProviderDetailClient from "./ProviderDetailClient";
import { notFound } from "next/navigation";

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const provider = await getProviderById(id);
  if (!provider) notFound();

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
        initialProvider={provider}
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
