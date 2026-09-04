import { NextRequest } from "next/server";
import { handleVideoGet } from "@/server/llm-gateway/media";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** GET /v1/videos/{request_id} - poll async video job status (xAI Grok Imagine) */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/v1/videos/[id]">) {
  const { id } = await params;
  return await handleVideoGet(request, id);
}
