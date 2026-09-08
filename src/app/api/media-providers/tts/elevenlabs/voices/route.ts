import { tenantRoute } from "@/server/application/http/tenantRoute";
import { GET as implGET } from "@/server/application/use-cases/http/media-providers/tts/elevenlabs/voices/route";

export const GET = tenantRoute(implGET);
