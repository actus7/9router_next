import { tenantRoute } from "@/server/application/http/tenantRoute";
import {
  DELETE as implDELETE,
  GET as implGET,
  PATCH as implPATCH,
  POST as implPOST,
} from "@/server/application/use-cases/http/harness/runs/route";

export const GET = tenantRoute(implGET);
export const POST = tenantRoute(implPOST);
export const PATCH = tenantRoute(implPATCH);
export const DELETE = tenantRoute(implDELETE);
