import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getProviderNodes } from "@/lib/data-access";
import MediaProviderDetailClient from "./MediaProviderDetailClient";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  isCustomEmbeddingDetail,
  isValidBuiltInMediaProviderDetail,
  isValidMediaProviderKind,
} from "../../validateDetailRoute";
import { withTenantPage } from "@/server/application/http/withTenantPage";
import { Spinner } from "@/shared/components/Loading";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

async function MediaProviderDetailContent({ params }: { params: Promise<{ kind: string; id: string }> }) {
  return withTenantPage(async () => {
    await assertRequestRuntime();
    const { kind, id } = await params;

    if (!isValidMediaProviderKind(kind)) notFound();

    const nodes = await getProviderNodes();

    if (isCustomEmbeddingDetail(kind, id)) {
      if (!nodes.some((node) => node.id === id)) notFound();
    } else if (!isValidBuiltInMediaProviderDetail(kind, id)) {
      notFound();
    }

    return (
      <MediaProviderDetailClient
        kind={kind}
        id={id}
        initialNodes={nodes as unknown as { id: string; name?: string; type?: string; prefix?: string }[]}
      />
    );
  });
}

export default function MediaProviderDetailPage({ params }: PageProps<"/dashboard/media-providers/[kind]/[id]">) {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><MediaProviderDetailContent params={params} /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
