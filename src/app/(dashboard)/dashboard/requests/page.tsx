import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import RequestDetailsTab from "../usage/components/RequestDetailsTab";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function RequestsPage() {
  return (
    <>
      <Suspense fallback={<CardSkeleton />}>
        <RequestDetailsTab />
      </Suspense>
      <MetadataIsDynamic />
    </>
  );
}
