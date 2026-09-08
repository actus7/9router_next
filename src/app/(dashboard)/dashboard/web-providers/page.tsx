import { Suspense } from "react";
import type { Metadata } from "next";
import { getProviders } from "@/lib/data-access";
import { withTenantPage } from "@/server/application/http/withTenantPage";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { Spinner } from "@/shared/components/Loading";
import WebProvidersClient from "./WebProvidersClient";

export const metadata: Metadata = { title: "Web Session Providers | ModelHub", description: "Conecte suas contas pelo navegador" };

async function WebProvidersContent() {
  return withTenantPage(async () => {
    await assertRequestRuntime();
    return <WebProvidersClient initialConnections={await getProviders()} />;
  });
}

export default function WebProvidersPage() {
  return <Suspense fallback={<div className="flex justify-center p-10"><Spinner size="lg" /></div>}><WebProvidersContent /></Suspense>;
}
