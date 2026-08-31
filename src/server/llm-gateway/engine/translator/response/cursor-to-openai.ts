/**
 * Cursor to OpenAI Response Translator
 * CursorExecutor already emits OpenAI format - this is a passthrough
 */
import { register } from "../registry";
import { FORMATS } from "../formats";

/**
 * Convert Cursor response to OpenAI format
 * Since CursorExecutor.transformProtobufToSSE/JSON already emits OpenAI chunks,
 * this is a passthrough translator (similar to Kiro pattern)
 */
function cursorToOpenAIResponse(chunk: Record<string, unknown>, state: Record<string, unknown>) {
  if (!chunk) return null;

  // If chunk is already in OpenAI format (from executor transform), return as-is
  if (chunk.object === "chat.completion.chunk" && chunk.choices) {
    return chunk;
  }

  // If chunk is a completion object (non-streaming), return as-is
  if (chunk.object === "chat.completion" && chunk.choices) {
    return chunk;
  }

  // Fallback: return chunk as-is (should not reach here)
  return chunk;
}

register(FORMATS.CURSOR, FORMATS.OPENAI, null, cursorToOpenAIResponse as unknown as Parameters<typeof register>[3]);
