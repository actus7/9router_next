import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/harness/sandbox/eval/route";

export const POST = tenantRoute(implPOST);
