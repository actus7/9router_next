import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/headroom/restart/route";

export const POST = tenantRoute(implPOST);
