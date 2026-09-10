import { tenantRoute } from "@/server/application/http/tenantRoute";
import { PUT as implPUT } from "@/server/application/use-cases/http/harness/skills/agent/route";

export const PUT = tenantRoute(implPUT);
