import { NextRequest } from "next/server";
import { handleChat } from "@/server/llm-gateway/chat";
import { initTranslators } from "@/server/llm-gateway/translator";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

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
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request: NextRequest) {
  await ensureInitialized();
  return await handleChat(request);
}
