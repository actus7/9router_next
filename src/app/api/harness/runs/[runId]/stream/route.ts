import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET } from "@/server/application/use-cases/http/harness/runs/stream/route";

export const GET = tenantRoute(implGET);
