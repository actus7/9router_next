import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, PUT as implPUT, DELETE as implDELETE } from "@/server/application/use-cases/http/keys/[id]/route";

export const GET = tenantRoute(implGET, { minRole: "member" });
export const PUT = tenantRoute(implPUT, { minRole: "member" });
export const DELETE = tenantRoute(implDELETE, { minRole: "member" });
