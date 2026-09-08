import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { NextRequest } from "next/server";
import { handleVideoCreate } from "@/server/llm-gateway/media";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/videos/edits - async video edit (xAI Grok Imagine) */
async function handlePOST(request: NextRequest) {
  return await handleVideoCreate(request, "edits");
}

export const POST = gatewayRoute(handlePOST);
