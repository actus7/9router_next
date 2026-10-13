import CloudPageClient from "./CloudPageClient";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function CloudPage() {
  return (
    <>
      <AdminOnly>
        <CloudPageClient />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
