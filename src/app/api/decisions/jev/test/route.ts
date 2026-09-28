import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/decisions/jevTest";

export const POST = tenantRoute(implPOST);
