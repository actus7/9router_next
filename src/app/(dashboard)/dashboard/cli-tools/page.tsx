import { getMachineId } from "@/shared/utils/machine";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { Spinner } from "@/shared/components/Loading";
import CLIToolsPageClient from "./CLIToolsPageClient";
import { AdminOnly } from "@/app/adminOnly";
import { MetadataIsDynamic } from "@/app/metadataIsDynamic";

async function CLIToolsContent() {
  await assertRequestRuntime();
  const machineId = await getMachineId();
  return <CLIToolsPageClient machineId={machineId} />;
}

export default function CLIToolsPage() {
  return (
    <>
      <AdminOnly fallback={<div className="flex items-center justify-center p-10"><Spinner size="lg" /></div>}><CLIToolsContent /></AdminOnly>
      <MetadataIsDynamic />
    </>
  );
}
