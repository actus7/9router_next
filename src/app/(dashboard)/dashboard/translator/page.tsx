import { Spinner } from "@/shared/components/Loading";
import TranslatorClient from "./TranslatorClient";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function TranslatorPage() {
  return (
    <>
      <AdminOnly fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}>
        <TranslatorClient />
      </AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
