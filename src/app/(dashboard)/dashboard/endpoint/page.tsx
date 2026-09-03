import { getMachineId } from "@/shared/utils/machine";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import EndpointPageClient from "./EndpointPageClient";

export default async function EndpointPage() {
  await assertRequestRuntime();
  const machineId = await getMachineId();
  return <EndpointPageClient machineId={machineId} />;
}
