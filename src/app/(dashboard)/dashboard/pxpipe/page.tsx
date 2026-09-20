import PxpipeClient from "./PxpipeClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function PxpipePage() {
  return (
    <>
      <PxpipeClient />
      <MetadataIsDynamic />
    </>
  );
}
