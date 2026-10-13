import { CardSkeleton } from "@/shared/components/Loading";
import UsageClient from "./UsageClient";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function UsagePage() {
  return (
    <>
      <AdminOnly fallback={<CardSkeleton />}>
        <UsageClient />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
