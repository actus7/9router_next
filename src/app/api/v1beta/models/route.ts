import { PROVIDER_MODELS } from "@/shared/constants/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getProviderAlias } from "@/shared/constants/providers";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET() {
  try {
    const models: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    function addModel({ name, displayName, description, methods = ["generateContent"] }: {
      name: string;
      displayName: string;
      description: string;
      methods?: string[];
    }) {
      if (seen.has(name)) return;
      seen.add(name);
      models.push({
        name,
        displayName,
        description,
        supportedGenerationMethods: methods,
        inputTokenLimit: 128000,
        outputTokenLimit: 8192,
      });
    }
    
    // A disabled model is hidden from /v1/models, so it stays hidden here too.
    // Read once: this loop covers every provider in the catalog.
    const disabled: Record<string, string[]> = await getDisabledModels().catch(() => ({}));
    const isDisabled = (provider: string, modelId: string): boolean => {
      const alias: string = getProviderAlias(provider) || provider;
      return (disabled[alias] || disabled[provider] || []).includes(modelId);
    };

    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels as Array<Record<string, unknown>>) {
        if (isDisabled(provider, String(model.id))) continue;
        addModel({
          name: `models/${provider}/${model.id}`,
          displayName: (model.name || model.id) as string,
          description: `${provider} model: ${model.name || model.id}`,
        });

        if (provider === "gemini") {
          addModel({
            name: `models/${model.id}`,
            displayName: (model.name || model.id) as string,
            description: `Gemini model: ${model.name || model.id}`,
            methods: ["generateContent", "streamGenerateContent"],
          });
        }
      }
    }

    return Response.json({ models });
  } catch (error: unknown) {
    console.error("Error fetching models:", error);
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
