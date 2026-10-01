import { tenantRoute } from "@/server/application/http/tenantRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/usage/classify-intents/route";

export const POST = tenantRoute(implPOST);
