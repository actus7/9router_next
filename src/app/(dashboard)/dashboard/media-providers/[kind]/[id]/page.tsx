import { Suspense } from "react";
import { getProviderNodes } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import MediaProviderDetailClient from "./MediaProviderDetailClient";

async function MediaProviderDetailContent() {
  const nodes = await getProviderNodes();
  return <MediaProviderDetailClient initialNodes={nodes as unknown as { id: string; name?: string; type?: string; prefix?: string }[]} />;
}

export default function MediaProviderDetailPage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><MediaProviderDetailContent /></Suspense>;
}
