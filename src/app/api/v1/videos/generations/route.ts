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

/** POST /v1/videos/generations - async video generation (xAI Grok Imagine) */
export async function POST(request: NextRequest) {
  return await handleVideoCreate(request, "generations");
}
