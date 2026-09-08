import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/providerNodes/validate";

export const POST = tenantRoute(implPOST);
