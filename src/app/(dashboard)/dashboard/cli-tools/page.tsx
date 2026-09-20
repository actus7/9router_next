import { Suspense } from "react";
import { getMachineId } from "@/shared/utils/machine";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { Spinner } from "@/shared/components/Loading";
import CLIToolsPageClient from "./CLIToolsPageClient";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

async function CLIToolsContent() {
  await assertRequestRuntime();
  const machineId = await getMachineId();
  return <CLIToolsPageClient machineId={machineId} />;
}

export default function CLIToolsPage() {
  return (
    <>
      <Suspense fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><CLIToolsContent /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
