import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { NextRequest } from "next/server";
import { handleStt } from "@/server/llm-gateway/media";

// Allow large audio uploads — 5min for processing large files
export const maxDuration = 300;

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/audio/transcriptions - OpenAI Whisper compatible STT */
async function handlePOST(request: NextRequest) {
  return await handleStt(request);
}

export const POST = gatewayRoute(handlePOST);
