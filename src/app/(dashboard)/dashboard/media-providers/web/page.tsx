import { Suspense } from "react";
import { getProviders, getCombos } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import WebMediaProvidersClient from "./WebMediaProvidersClient";

export default async function WebMediaProvidersPage() {
  const [connections, combos] = await Promise.all([
    getProviders(),
    getCombos(),
  ]);

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-10">
          <Spinner size="lg" />
        </div>
      }
    >
      <WebMediaProvidersClient initialConnections={connections} initialCombos={combos as unknown as { id: string; name: string; kind?: string; models: string[] }[]} />
    </Suspense>
  );
}
