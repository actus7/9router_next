import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET } from "@/server/application/use-cases/http/oauth/cursor/auto-import/route";

export const GET = tenantRoute(implGET);
