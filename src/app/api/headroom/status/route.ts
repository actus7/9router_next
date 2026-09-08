import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET } from "@/server/application/use-cases/http/headroom/status/route";

export const GET = tenantRoute(implGET);
