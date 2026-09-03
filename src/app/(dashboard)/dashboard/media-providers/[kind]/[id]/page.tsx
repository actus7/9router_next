import { notFound } from "next/navigation";
import { getProviderNodes } from "@/lib/data-access";
import MediaProviderDetailClient from "./MediaProviderDetailClient";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  isCustomEmbeddingDetail,
  isValidBuiltInMediaProviderDetail,
  isValidMediaProviderKind,
} from "../../validateDetailRoute";

interface PageProps {
  params: Promise<{ kind: string; id: string }>;
}

export default async function MediaProviderDetailPage({ params }: PageProps) {
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
}
