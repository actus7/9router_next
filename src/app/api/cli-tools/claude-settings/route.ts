import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET, POST as implPOST, DELETE as implDELETE } from "@/server/application/use-cases/http/cli-tools/claude-settings/route";

export const GET = tenantRoute(implGET);
export const POST = tenantRoute(implPOST);
export const DELETE = tenantRoute(implDELETE);
