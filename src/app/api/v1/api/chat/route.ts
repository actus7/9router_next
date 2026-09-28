import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { NextRequest } from "next/server";
import { handleChat, ollamaChatToOpenAI, ollamaError, transformToOllama } from "@/server/llm-gateway/chat";
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

async function handlePOST(request: NextRequest) {
  await ensureInitialized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return ollamaError(400, "Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return ollamaError(400, "Invalid JSON body");

  const openAIBody = ollamaChatToOpenAI(body);
  // The original length describes the Ollama body, not the translated one.
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const startedAt = Date.now();
  const response = await handleChat(new Request(request.url, { method: "POST", headers, body: JSON.stringify(openAIBody) }));
  return transformToOllama(response, String(body.model ?? ""), { stream: openAIBody.stream === true, startedAt });
}

export const POST = gatewayRoute(handlePOST);
