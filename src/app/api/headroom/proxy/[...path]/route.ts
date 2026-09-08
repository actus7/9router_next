import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, POST as implPOST, PUT as implPUT, PATCH as implPATCH, DELETE as implDELETE, HEAD as implHEAD, OPTIONS as implOPTIONS } from "@/server/application/use-cases/http/headroom/proxy/[...path]/route";

export const GET = tenantRoute(implGET);
export const POST = tenantRoute(implPOST);
export const PUT = tenantRoute(implPUT);
export const PATCH = tenantRoute(implPATCH);
export const DELETE = tenantRoute(implDELETE);
export const HEAD = tenantRoute(implHEAD);
export const OPTIONS = tenantRoute(implOPTIONS);
