import { tenantRoute } from "@/server/application/http/tenantRoute";
import { streamSuggestSuggestions } from "@/server/application/use-cases/smart-routing/suggestProfiles";

/**
 * Thin transport adapter for "Suggest models with AI": relay the use-case's
 * NDJSON stream. The request carries no options — the suggestion is computed
 * from the inventory and the Artificial Analysis snapshot alone.
 */
async function handlePOST(): Promise<Response> {
  return new Response(streamSuggestSuggestions(), {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

export const POST = tenantRoute(handlePOST);
