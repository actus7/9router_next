import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function QuotaPage() {
  return (
    <>
      <AdminOnly fallback={<CardSkeleton />}>
        <ProviderLimits />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
