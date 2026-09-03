import { getMachineId } from "@/shared/utils/machine";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import CLIToolsPageClient from "./CLIToolsPageClient";

export default async function CLIToolsPage() {
  await assertRequestRuntime();
  const machineId = await getMachineId();
  return <CLIToolsPageClient machineId={machineId} />;
}
