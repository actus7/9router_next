import { tenantRoute } from "@/server/application/http/tenantRoute";
import { listSynapseCapabilities, forgetSynapseLearning } from "@/server/application/use-cases/http/synapse/capabilities";

export const GET = tenantRoute(listSynapseCapabilities);
export const DELETE = tenantRoute(forgetSynapseLearning);
