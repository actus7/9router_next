import { Suspense } from "react";
import { getProviders, getCombos } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import WebMediaProvidersClient from "./WebMediaProvidersClient";

async function WebMediaProvidersContent() {
  await assertRequestRuntime();
  const [connections, combos] = await Promise.all([
    getProviders(),
    getCombos(),
  ]);

  return <WebMediaProvidersClient initialConnections={connections} initialCombos={combos as unknown as { id: string; name: string; kind?: string; models: string[] }[]} />;
}

export default function WebMediaProvidersPage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><WebMediaProvidersContent /></Suspense>;
}
