import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, PATCH as implPATCH } from "@/server/application/use-cases/http/settings/route";

export const GET = tenantRoute(implGET, { minRole: "member" });
export const PATCH = tenantRoute(implPATCH);
