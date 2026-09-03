import { NextRequest } from "next/server";
import { buildModelsList } from "./buildModelsList";
import { INTERNAL_MODELS_FETCH_HEADER, LLM_KIND } from "./modelsListTypes";

export { buildModelsList } from "./buildModelsList";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).
 * For other capabilities use /v1/models/{kind} (image, tts, stt, embedding, image-to-text, web).
 */
export async function GET(request: NextRequest) {
  try {
    // Detect cross-instance recursive /models fetch (another modelhub fetching our /models)
    const skipDynamicFetch = request?.headers?.get(INTERNAL_MODELS_FETCH_HEADER) === "1";
    const data = await buildModelsList([LLM_KIND], { skipDynamicFetch });
    return Response.json({ object: "list", data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error: unknown) {
    console.error("Error fetching models:", error);
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error), type: "server_error" } },
      { status: 500 }
    );
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
