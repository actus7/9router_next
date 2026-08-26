import { Suspense } from "react";
import { getProviderNodes } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import MediaProviderDetailClient from "./MediaProviderDetailClient";

export default async function MediaProviderDetailPage() {
  const nodes = await getProviderNodes();

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-10">
          <Spinner size="lg" />
        </div>
      }
    >
      <MediaProviderDetailClient initialNodes={nodes} />
    </Suspense>
  );
}
