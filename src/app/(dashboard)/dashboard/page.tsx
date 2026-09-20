import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import UsageClient from "./usage/UsageClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function DashboardPage() {
  return (
    <>
      <Suspense fallback={<CardSkeleton />}>
        <UsageClient />
      </Suspense>
      <MetadataIsDynamic />
    </>
  );
}
