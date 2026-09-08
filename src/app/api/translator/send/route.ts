import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/translator/send/route";

export const POST = tenantRoute(implPOST);
