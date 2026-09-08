import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/harness/learning/review/route";

export const POST = tenantRoute(implPOST);
