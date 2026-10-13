import PxpipeClient from "./PxpipeClient";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function PxpipePage() {
  return (
    <>
      <AdminOnly>
        <PxpipeClient />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
