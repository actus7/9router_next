import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET } from "@/server/application/use-cases/http/cli-tools/all-statuses/route";

export const GET = tenantRoute(implGET);
