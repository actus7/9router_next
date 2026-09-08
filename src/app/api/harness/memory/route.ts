import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, PUT as implPUT, POST as implPOST } from "@/server/application/use-cases/http/harness/memory/route";

export const GET = tenantRoute(implGET);
export const PUT = tenantRoute(implPUT);
export const POST = tenantRoute(implPOST);
