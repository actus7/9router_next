import { Suspense } from "react";
import { Spinner } from "@/shared/components/Loading";
import TranslatorClient from "./TranslatorClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

export default function TranslatorPage() {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}>
        <TranslatorClient />
      </Suspense>
      <MetadataIsDynamic />
    </>
  );
}
