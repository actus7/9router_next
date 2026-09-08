import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/smart-routing/profiles/confirm/route";

export const POST = tenantRoute(implPOST);
