import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, POST as implPOST, PATCH as implPATCH, DELETE as implDELETE } from "@/server/application/use-cases/http/providers/route";

export const GET = tenantRoute(implGET);
export const POST = tenantRoute(implPOST);
export const PATCH = tenantRoute(implPATCH);
export const DELETE = tenantRoute(implDELETE);
