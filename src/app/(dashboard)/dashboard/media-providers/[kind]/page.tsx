import { Suspense } from "react";
import { getProviders, getProviderNodes, getCombos } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import MediaProviderKindClient from "./MediaProviderKindClient";

async function MediaProviderKindContent() {
  const [connections, nodes, combos] = await Promise.all([
    getProviders(),
    getProviderNodes(),
    getCombos(),
  ]);

  return (
    <MediaProviderKindClient
        initialConnections={connections as unknown as { provider: string; isActive?: boolean; testStatus?: string; [key: string]: unknown }[]}
        initialNodes={nodes as unknown as { id: string; name?: string; type?: string; prefix?: string }[]}
        initialCombos={combos as unknown as { id: string; name: string; kind?: string; models: string[] }[]}
    />
  );
}

export default function MediaProviderKindPage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><MediaProviderKindContent /></Suspense>;
}
