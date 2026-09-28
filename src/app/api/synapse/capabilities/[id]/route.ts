import { tenantRoute } from "@/server/application/http/tenantRoute";
import { patchSynapseCapability, deleteSynapseCapability } from "@/server/application/use-cases/http/synapse/capabilities";

export const PATCH = tenantRoute(patchSynapseCapability);
export const DELETE = tenantRoute(deleteSynapseCapability);
