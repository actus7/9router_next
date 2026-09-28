import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { NextRequest } from "next/server";
import { listGatewayVoices } from "@/server/application/use-cases/http/v1/audio/voices";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function OPTIONS() {
  return new Response(null, {
    headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

// GET /v1/audio/voices?provider={p}[&lang=xx]
// Returns OpenAI-style list with each voice's full model id ready for /v1/audio/speech
async function handleGET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const result = await listGatewayVoices(searchParams.get("provider") || "", searchParams.get("lang"));
    if (!result.ok) {
      const type = result.status === 400 ? "invalid_request_error" : "server_error";
      return Response.json({ error: { message: result.message, type } }, { status: result.status, headers: CORS });
    }
    return Response.json({ object: "list", data: result.data }, { headers: CORS });
  } catch (err: unknown) {
    return Response.json(
      { error: { message: err instanceof Error ? err.message : String(err), type: "server_error" } },
      { status: 502, headers: CORS },
    );
  }
}

export const GET = gatewayRoute(handleGET);
