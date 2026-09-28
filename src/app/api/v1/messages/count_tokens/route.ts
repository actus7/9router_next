import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { NextRequest } from "next/server";
import { estimateAnthropicInputTokens } from "@/server/llm-gateway/application/countTokens";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * POST /v1/messages/count_tokens - estimated token count (see estimateAnthropicInputTokens)
 */
async function handlePOST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  return new Response(JSON.stringify({
    input_tokens: estimateAnthropicInputTokens(body)
  }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

export const POST = gatewayRoute(handlePOST);
