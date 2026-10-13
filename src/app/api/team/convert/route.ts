import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/team/convert/route";

export const POST = tenantRoute(implPOST, { minRole: "owner" });
