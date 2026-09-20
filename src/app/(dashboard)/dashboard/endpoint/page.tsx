import { Suspense } from "react";
import { getMachineId } from "@/shared/utils/machine";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { Spinner } from "@/shared/components/Loading";
import EndpointPageClient from "./EndpointPageClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

async function EndpointContent() {
  await assertRequestRuntime();
  const machineId = await getMachineId();
  return <EndpointPageClient machineId={machineId} />;
}

export default function EndpointPage() {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><EndpointContent /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
