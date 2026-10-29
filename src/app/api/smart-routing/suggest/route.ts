import { tenantRoute } from "@/server/application/http/tenantRoute";
import { streamSuggestSuggestions } from "@/server/application/use-cases/smart-routing/suggestProfiles";

const MAX_SCOPED_MODELS = 500;

/** `{ models }` from a combo restricted to chosen models; anything else means the whole inventory. */
async function scopedModels(request: Request): Promise<string[] | undefined> {
  const body: unknown = await request.json().catch(() => null);
  const models = body && typeof body === "object" ? (body as { models?: unknown }).models : undefined;
  if (!Array.isArray(models)) return undefined;
  return models.filter((model): model is string => typeof model === "string").slice(0, MAX_SCOPED_MODELS);
}

/**
 * Thin transport adapter for "Suggest models with AI": relay the use-case's
 * NDJSON stream. The suggestion is computed from the inventory (or the combo's
 * chosen models) and the Artificial Analysis snapshot alone.
 */
async function handlePOST(request: Request): Promise<Response> {
  return new Response(streamSuggestSuggestions(await scopedModels(request)), {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

export const POST = tenantRoute(handlePOST);
