import TokenSaverClient from "./TokenSaverClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function TokenSaverPage() {
  return (
    <>
      <TokenSaverClient />
      <MetadataIsDynamic />
    </>
  );
}
