import CloudPageClient from "./CloudPageClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function CloudPage() {
  return (
    <>
      <CloudPageClient />
      <MetadataIsDynamic />
    </>
  );
}
