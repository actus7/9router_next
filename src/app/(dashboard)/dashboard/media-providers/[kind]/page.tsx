import { Suspense } from "react";
import { getProviders, getProviderNodes, getCombos } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import MediaProviderKindClient from "./MediaProviderKindClient";

export default async function MediaProviderKindPage() {
  const [connections, nodes, combos] = await Promise.all([
    getProviders(),
    getProviderNodes(),
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
      <MediaProviderKindClient
        initialConnections={connections as unknown as { provider: string; isActive?: boolean; testStatus?: string; [key: string]: unknown }[]}
        initialNodes={nodes as unknown as { id: string; name?: string; type?: string; prefix?: string }[]}
        initialCombos={combos as unknown as { id: string; name: string; kind?: string; models: string[] }[]}
      />
    </Suspense>
  );
}
