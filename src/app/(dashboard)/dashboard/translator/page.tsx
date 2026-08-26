import { Suspense } from "react";
import { Spinner } from "@/shared/components/Loading";
import TranslatorClient from "./TranslatorClient";

export default function TranslatorPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}>
      <TranslatorClient />
    </Suspense>
  );
}
