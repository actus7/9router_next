import { NextRequest } from "next/server";
import { handleChat } from "@/server/llm-gateway/chat";
import { FORMATS, translateRequest } from "@/server/llm-gateway/translator";

import { forwardGeminiNativeRequest, isGeminiNativeTtsRequest } from "../geminiNativeForward";
import { countGeminiTokens } from "../countGeminiTokens";
import { openaiJsonToGemini, openaiSseToGemini } from "../openaiToGeminiResponse";

const CORS = { "Access-Control-Allow-Origin": "*" };
const ACTIONS = new Set([":generateContent", ":streamGenerateContent", ":countTokens"]);

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      ...CORS,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function geminiError(status: number, message: string) {
  return Response.json({ error: { code: status, message } }, { status, headers: CORS });
}

/**
 * `["openai", "gpt-4o:generateContent"]` → model `openai/gpt-4o`. Every segment
 * is kept: ids like `openrouter/meta-llama/llama-3` have more than one slash.
 */
function parsePath(path: string[]): { model: string; action: string } | null {
  const joined = path.join("/");
  const colon = joined.lastIndexOf(":");
  if (colon <= 0) return null;
  const action = joined.slice(colon);
  return ACTIONS.has(action) ? { model: joined.slice(0, colon), action } : null;
}

/**
 * POST /v1beta/models/{model}:generateContent | :streamGenerateContent | :countTokens
 *
 * Streaming is decided by the URL action (the Gemini convention), never by a
 * body field. The Gemini body goes through the engine's own gemini→openai
 * translator — tools, functionCall/functionResponse, inlineData, stop
 * sequences — and then through `handleChat` like any OpenAI request, so it
 * gets the same routing, combos and fallback. The answer is reshaped back to
 * Gemini in `openaiToGeminiResponse`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const parsed = parsePath((await params).path || []);
  if (!parsed) return geminiError(404, "Unknown model action");
  const { model, action } = parsed;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return geminiError(400, "Invalid JSON body");
  }

  if (action === ":countTokens") {
    return Response.json({ totalTokens: countGeminiTokens(body) }, { headers: CORS });
  }

  if (isGeminiNativeTtsRequest(model, body)) {
    return forwardGeminiNativeRequest(request, body, model, action);
  }

  try {
    const stream = action === ":streamGenerateContent";
    const openaiBody = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, model, body, stream);
    // Gemini clients track context from usageMetadata; ask for usage on the stream.
    if (stream) openaiBody.stream_options = { include_usage: true };

    const response = await handleChat(new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(openaiBody),
    }));

    return stream ? openaiSseToGemini(response, model) : await openaiJsonToGemini(response, model);
  } catch (error: unknown) {
    console.error("Error handling Gemini request:", error);
    return geminiError(500, error instanceof Error ? error.message : String(error));
  }
}
