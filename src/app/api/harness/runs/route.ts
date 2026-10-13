import { tenantRoute } from "@/server/application/http/tenantRoute";
import {
  DELETE as implDELETE,
  GET as implGET,
  PATCH as implPATCH,
  POST as implPOST,
} from "@/server/application/use-cases/http/harness/runs/route";

export const GET = tenantRoute(implGET, { minRole: "member" });
export const POST = tenantRoute(implPOST, { minRole: "member" });
export const PATCH = tenantRoute(implPATCH, { minRole: "member" });
export const DELETE = tenantRoute(implDELETE, { minRole: "member" });
