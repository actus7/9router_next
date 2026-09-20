import { Suspense } from "react";
import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";
import { getProviders, getProviderNodes } from "@/lib/data-access";
import ProvidersClient from "./ProvidersClient";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { Spinner } from "@/shared/components/Loading";
import { withTenantPage } from "@/server/application/http/withTenantPage";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Providers | ModelHub",
    "Manage AI provider connections",
  );
}

async function ProvidersContent() {
  return withTenantPage(async () => {
    await assertRequestRuntime();
    const [providers, nodes] = await Promise.all([
      getProviders(),
      getProviderNodes(),
    ]);

    return <ProvidersClient initialConnections={providers} initialNodes={nodes as Array<{ id: string; name?: string; type?: string; apiType?: string }>} />;
  });
}

export default function ProvidersPage() {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ProvidersContent /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
