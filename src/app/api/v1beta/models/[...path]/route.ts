import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { POST as implPOST } from "@/server/application/use-cases/http/v1beta/models/[...path]/route";
export { OPTIONS } from "@/server/application/use-cases/http/v1beta/models/[...path]/route";

export const POST = gatewayRoute(implPOST);
