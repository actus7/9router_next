import { tenantRoute } from "@/server/application/http/tenantRoute";
import { ollamaModels } from "@/server/llm-gateway/catalog";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

async function handleOPTIONS(): Promise<Response> {
  return new Response(null, { headers: CORS_HEADERS });
}

async function handleGET(): Promise<Response> {
  return new Response(JSON.stringify(ollamaModels), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

export const OPTIONS = tenantRoute(handleOPTIONS);
export const GET = tenantRoute(handleGET);
