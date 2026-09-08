import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/harness/search/sessions/route";

export const POST = tenantRoute(implPOST);
