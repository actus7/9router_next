import { Suspense } from "react";
import { getProxyPoolsWithUsage } from "@/lib/data-access";
import { Spinner } from "@/shared/components/Loading";
import ProxyPoolsClient from "./ProxyPoolsClient";

export default async function ProxyPoolsPage() {
  const proxyPools = await getProxyPoolsWithUsage();

  return (
    <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}>
      <ProxyPoolsClient initialProxyPools={proxyPools as any[]} />
    </Suspense>
  );
}
