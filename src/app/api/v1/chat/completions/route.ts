import { NextRequest } from "next/server";
import { handleChat } from "@/server/llm-gateway/chat";
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

export async function POST(request: NextRequest) {  
  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}

