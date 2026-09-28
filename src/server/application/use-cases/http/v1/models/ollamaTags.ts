import { buildModelsList } from "./buildModelsList";
import { INTERNAL_MODELS_FETCH_HEADER, LLM_KIND } from "./modelsListTypes";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function OPTIONS() {
  return new Response(null, {
    headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" },
  });
}

/**
 * GET /api/tags — the Ollama model list, from the same account catalogue as
 * /v1/models. Ollama clients only read `name`/`model`; the size/digest/details
 * fields describe local weights we do not have, so they are present and empty
 * because clients like Open WebUI index into them.
 */
export async function GET(request: Request) {
  try {
    const skipDynamicFetch = request.headers.get(INTERNAL_MODELS_FETCH_HEADER) === "1";
    const data = await buildModelsList([LLM_KIND], { skipDynamicFetch });
    const modifiedAt = new Date().toISOString();
    const models = data.map((m) => ({
      name: String(m.id),
      model: String(m.id),
      modified_at: modifiedAt,
      size: 0,
      digest: "",
      details: { format: "", family: "", parameter_size: "", quantization_level: "" },
    }));
    return Response.json({ models }, { headers: CORS });
  } catch (error: unknown) {
    console.error("Error fetching Ollama tags:", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: CORS });
  }
}
