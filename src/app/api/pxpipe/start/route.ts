import { POST as implPOST } from "@/server/application/use-cases/http/pxpipe/start/route";
import { tenantRoute } from "@/server/application/http/tenantRoute";

export const maxDuration = 300;

export const POST = tenantRoute(implPOST);
