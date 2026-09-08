import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET } from "@/server/application/use-cases/http/usage/[connectionId]/route";

export const GET = tenantRoute(implGET);
