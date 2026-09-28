import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { GET as implGET } from "@/server/application/use-cases/http/v1/models/ollamaTags";
export { OPTIONS } from "@/server/application/use-cases/http/v1/models/ollamaTags";

// API key, not a dashboard session: Ollama clients are programs holding a key.
export const GET = gatewayRoute(implGET);
