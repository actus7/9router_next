import { tenantRoute } from "@/server/application/http/tenantRoute";
import { DELETE as implDELETE, GET as implGET, PUT as implPUT } from "@/server/application/use-cases/http/decisions/jevKey";

export const GET = tenantRoute(implGET);
export const PUT = tenantRoute(implPUT);
export const DELETE = tenantRoute(implDELETE);
