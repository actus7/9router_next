import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { GET as implGET } from "@/server/application/use-cases/http/v1/models/route";
export { OPTIONS } from "@/server/application/use-cases/http/v1/models/route";

export const GET = gatewayRoute(implGET);
