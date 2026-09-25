import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { NextRequest } from "next/server";
import { buildModelsList } from "@/server/application/use-cases/http/v1/models/route";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP: Record<string, string[]> = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
  "video": ["video"],
};
const ALL_KINDS = ["llm", ...new Set(Object.values(KIND_SLUG_MAP).flat())];
const CORS = { "Access-Control-Allow-Origin": "*" };

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
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 * Supported kinds: image, tts, stt, embedding, image-to-text, web, video.
 *
 * GET /v1/models/{model} - OpenAI `models.retrieve`. Catch-all because model
 * ids carry the provider alias ("openai/gpt-4o"). A kind slug wins over a model
 * of the same name.
 */
async function handleGET(_request: NextRequest, { params }: RouteContext<"/api/v1/models/[...id]">) {
  try {
    const { id: segments } = await params;
    const id = segments.join("/");
    const kindFilter = segments.length === 1 ? KIND_SLUG_MAP[id] : undefined;

    if (kindFilter) {
      const data = await buildModelsList(kindFilter);
      return Response.json({ object: "list", data }, { headers: CORS });
    }

    // ponytail: builds the whole list to find one id; index it if retrieve gets hot.
    const model = (await buildModelsList(ALL_KINDS)).find((m) => m.id === id);
    if (!model) {
      return Response.json(
        { error: { message: `The model '${id}' does not exist`, type: "invalid_request_error", code: "model_not_found" } },
        { status: 404, headers: CORS },
      );
    }
    return Response.json(
      { id: model.id, object: "model", created: model.created, owned_by: model.owned_by },
      { headers: CORS },
    );
  } catch (error: unknown) {
    console.error("Error fetching models:", error);
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error), type: "server_error" } },
      { status: 500 }
    );
  }
}

export const GET = gatewayRoute(handleGET);
