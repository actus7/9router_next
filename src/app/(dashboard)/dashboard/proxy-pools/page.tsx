import { Suspense } from "react";
import { getProxyPoolsWithUsage } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import ProxyPoolsClient, { type ProxyPool } from "./ProxyPoolsClient";

async function ProxyPoolsContent() {
  const proxyPools = await getProxyPoolsWithUsage();

  return <ProxyPoolsClient initialProxyPools={proxyPools as unknown as ProxyPool[]} />;
}

export default function ProxyPoolsPage() {
  return <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><ProxyPoolsContent /></Suspense>;
}
