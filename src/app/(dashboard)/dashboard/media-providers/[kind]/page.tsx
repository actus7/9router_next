import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getProviders, getProviderNodes, getCombos } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import { isCombinedWebKind, mediaProviderListingHref } from "../listingHref";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import MediaProviderKindClient from "./MediaProviderKindClient";
import { withTenantPage } from "@/server/application/http/withTenantPage";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

/**
 * The tenant scope belongs here, under the `<Suspense>`, not around the page's
 * return: React resumes a suspended child under a context snapshot it captured
 * before the `run()` scope existed, so the reads below would land outside it
 * and throw `TenantContextError`. `withTenantPage` documents the same trap for
 * `enterWith()`; a boundary between the `run()` and the read reopens it.
 */
async function MediaProviderKindContent({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  // webSearch and webFetch share the combined /web listing. Redirecting here
  // means the stub route never renders, so it can no longer navigate mid-render.
  if (isCombinedWebKind(kind)) redirect(mediaProviderListingHref(kind));

  return withTenantPage(async () => {
    await assertRequestRuntime();
    const [connections, nodes, combos] = await Promise.all([
      getProviders(),
      getProviderNodes(),
      getCombos(),
    ]);

    return (
      <MediaProviderKindClient
          initialConnections={connections as unknown as { provider: string; isActive?: boolean; testStatus?: string; [key: string]: unknown }[]}
          initialNodes={nodes as unknown as { id: string; name?: string; type?: string; prefix?: string }[]}
          initialCombos={combos as unknown as { id: string; name: string; kind?: string; models: string[] }[]}
      />
    );
  });
}

export default function MediaProviderKindPage({ params }: PageProps<"/dashboard/media-providers/[kind]">) {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><MediaProviderKindContent params={params} /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
