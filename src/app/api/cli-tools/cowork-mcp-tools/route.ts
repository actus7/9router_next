import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/cli-tools/cowork-mcp-tools/route";

export const POST = tenantRoute(implPOST);
