import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import UsageClient from "./UsageClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function UsagePage() {
  return (
    <>
      <Suspense fallback={<CardSkeleton />}>
        <UsageClient />
      </Suspense>
      <MetadataIsDynamic />
    </>
  );
}
