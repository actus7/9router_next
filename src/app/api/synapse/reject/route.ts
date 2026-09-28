import { tenantRoute } from "@/server/application/http/tenantRoute";
import { rejectSynapseAnswer } from "@/server/application/use-cases/http/synapse/capabilities";

export const POST = tenantRoute(rejectSynapseAnswer);
