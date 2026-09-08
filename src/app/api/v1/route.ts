import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { GET as implGET } from "./models/route";
export { OPTIONS } from "./models/route";

export const GET = gatewayRoute(implGET);
