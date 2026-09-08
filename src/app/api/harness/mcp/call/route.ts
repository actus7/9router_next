import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/harness/mcp/call/route";

export const POST = tenantRoute(implPOST);
