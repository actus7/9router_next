import { ollamaModels } from "@/server/llm-gateway/catalog";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify(ollamaModels), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
