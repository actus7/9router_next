import { NextRequest } from "next/server";
import { tenantRoute } from "@/server/application/http/tenantRoute";
import {
  streamSuggestSuggestions,
  type SuggestRequestBody,
} from "@/server/application/use-cases/smart-routing/suggestProfiles";

/**
 * Thin transport adapter for "Suggest models with AI": parse the body, hand
 * everything else (cache, batching, prompts, the NDJSON progress contract) to
 * the use-case and relay its stream.
 */
async function handlePOST(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const parsed: SuggestRequestBody = {
    ...(body.webResearch === false ? { webResearch: false } : {}),
    ...(typeof body.classifierModel === "string" ? { classifierModel: body.classifierModel } : {}),
    ...(Array.isArray(body.modelKeys)
      ? { modelKeys: body.modelKeys.filter((key: unknown): key is string => typeof key === "string") }
      : {}),
    ...(body.force === true ? { force: true } : {}),
  };
  return new Response(streamSuggestSuggestions(request, parsed), {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

export const POST = tenantRoute(handlePOST);
