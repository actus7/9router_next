import { register } from "../registry";
import { FORMATS } from "../formats";
import { openaiToGeminiRequest } from "./openai-to-gemini";
import { DEFAULT_THINKING_VERTEX_SIGNATURE } from "../../config/defaultThinkingSignature";

/**
 * Post-process a Gemini-format body for Vertex AI compatibility:
 *
 * 1. Replace all synthetic thoughtSignatures with Vertex-native signature.
 * 2. Strip `id` from functionCall and functionResponse (Vertex rejects these).
 */
function postProcessForVertex(body: Record<string, unknown>) {
  if (!body?.contents) return body;

  for (const turn of body.contents as Record<string, unknown>[]) {
    if (!Array.isArray(turn.parts)) continue;

    for (const part of turn.parts as Record<string, unknown>[]) {
      // Replace any synthetic signature with Vertex-native one
      if (part.thoughtSignature !== undefined) {
        part.thoughtSignature = DEFAULT_THINKING_VERTEX_SIGNATURE;
      }
      // Strip id from functionCall
      if (part.functionCall && typeof part.functionCall === "object" && "id" in part.functionCall) {
        delete (part.functionCall as Record<string, unknown>).id;
      }
      // Strip id from functionResponse
      if (part.functionResponse && typeof part.functionResponse === "object" && "id" in part.functionResponse) {
        delete (part.functionResponse as Record<string, unknown>).id;
      }
    }
  }

  return body;
}

function openaiToVertexRequest(model: string, body: Record<string, unknown>, stream: boolean, _credentials?: unknown) {
  const gemini = openaiToGeminiRequest(model, body, stream);
  return postProcessForVertex(gemini);
}

register(FORMATS.OPENAI, FORMATS.VERTEX, openaiToVertexRequest, null);
