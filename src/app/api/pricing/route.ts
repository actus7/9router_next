import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, PATCH as implPATCH, DELETE as implDELETE } from "@/server/application/use-cases/http/pricing/route";

export const GET = tenantRoute(implGET);
export const PATCH = tenantRoute(implPATCH);
export const DELETE = tenantRoute(implDELETE);
