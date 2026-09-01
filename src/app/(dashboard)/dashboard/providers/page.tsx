import { Suspense } from "react";
import type { Metadata } from "next";
import { getProviders, getProviderNodes } from "@/lib/data-access";
import ProvidersClient from "./ProvidersClient";
import { Spinner } from "@/shared/components/Loading";

export const metadata: Metadata = {
  title: "Providers | ModelHub",
  description: "Manage AI provider connections",
};

async function ProvidersContent() {
  const [providers, nodes] = await Promise.all([
    getProviders(),
    getProviderNodes(),
  ]);

  return <ProvidersClient initialConnections={providers} initialNodes={nodes as Array<{ id: string; name?: string; type?: string; apiType?: string }>} />;
}

export default function ProvidersPage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ProvidersContent /></Suspense>;
}
