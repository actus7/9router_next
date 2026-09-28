import { buildModelsList } from "../../v1/models/buildModelsList";
import { LLM_KIND } from "../../v1/models/modelsListTypes";

/**
 * GET /v1beta/models — the same account-aware list as /v1/models (connected
 * providers, discovered models, combos, disabled models hidden, per-model
 * limits), in Gemini's shape. It used to walk the static registry, which listed
 * ~150 providers to an account with no connections and none of the discovered
 * catalogue.
 */

const METHODS = ["generateContent", "streamGenerateContent", "countTokens"];

export async function GET() {
  try {
    const entries = await buildModelsList([LLM_KIND]);
    const models = entries.map((entry) => {
      const id = String(entry.id);
      const model: Record<string, unknown> = {
        name: `models/${id}`,
        displayName: (entry.name as string | undefined) || id,
        supportedGenerationMethods: METHODS,
      };
      if (Number.isFinite(entry.context_length)) model.inputTokenLimit = entry.context_length;
      if (Number.isFinite(entry.max_completion_tokens)) model.outputTokenLimit = entry.max_completion_tokens;
      return model;
    });
    return Response.json({ models }, { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (error: unknown) {
    console.error("Error fetching models:", error);
    return Response.json(
      { error: { code: 500, message: error instanceof Error ? error.message : String(error), status: "INTERNAL" } },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
