import { CardSkeleton } from "@/shared/components/Loading";
import UsageClient from "./usage/UsageClient";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function DashboardPage() {
  return (
    <>
      <AdminOnly fallback={<CardSkeleton />}>
        <UsageClient />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
