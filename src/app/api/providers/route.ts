import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, POST as implPOST } from "@/server/application/use-cases/http/providers/route";

export const GET = tenantRoute(implGET);
export const POST = tenantRoute(implPOST);
