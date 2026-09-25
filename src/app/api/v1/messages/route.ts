import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { NextRequest } from "next/server";
import { handleChat, toAnthropicErrorResponse } from "@/server/llm-gateway/chat";
import { initTranslators } from "@/server/llm-gateway/translator";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/messages - Claude format (auto convert via handleChat)
 */
async function handlePOST(request: NextRequest) {
  await ensureInitialized();
  return await handleChat(request);
}

const gatewayPOST = gatewayRoute(handlePOST);

// Outermost, so the wrapper's own 401/429 are re-shaped too.
export async function POST(request: NextRequest) {
  return toAnthropicErrorResponse(await gatewayPOST(request));
}
