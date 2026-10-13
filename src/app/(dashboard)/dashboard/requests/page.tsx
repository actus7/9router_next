import { CardSkeleton } from "@/shared/components/Loading";
import RequestDetailsTab from "../usage/components/RequestDetailsTab";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function RequestsPage() {
  return (
    <>
      <AdminOnly fallback={<CardSkeleton />}>
        <RequestDetailsTab />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
