import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET } from "@/server/application/use-cases/http/providers/[id]/models/route";

export const GET = tenantRoute(implGET);
