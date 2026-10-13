import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, PUT as implPUT } from "@/server/application/use-cases/http/keys/[id]/profile/route";

export const GET = tenantRoute(implGET, { minRole: "member" });
export const PUT = tenantRoute(implPUT, { minRole: "member" });
