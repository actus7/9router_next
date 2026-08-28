import { register } from "../index";
import { FORMATS } from "../formats";
import { parseDataUri } from "../concerns/image";
import { safeParseJSON } from "../concerns/json";
import { ROLE, OPENAI_BLOCK } from "../schema/index";

/**
 * Convert OpenAI request to Ollama format
 *
 * Ollama expects:
 * - model: string
 * - messages: Array<{role: string, content: string, images?: string[] }>
 * - stream: boolean
 * - options?: {temperature?: number, num_predict?: number}
 *
 * Key differences from OpenAI:
 * - Content must be string, not array
 * - Multimodal images should be mapped to `message.images[]` (raw base64, no data: prefix)
 * - tool role maps to tool (Ollama supports tool messages)
 */
export function openaiToOllamaRequest(model: string, body: Record<string, unknown>, stream: boolean) {
  const result: Record<string, unknown> = {
    model: model,
    messages: normalizeMessages(body.messages),
    stream: stream
  };

  // Temperature
  if (body.temperature !== undefined) {
    if (!result.options) result.options = {} as Record<string, unknown>;
    (result.options as Record<string, unknown>).temperature = body.temperature;
  }

  // Max tokens (Ollama uses num_predict)
  if (body.max_tokens !== undefined) {
    if (!result.options) result.options = {} as Record<string, unknown>;
    (result.options as Record<string, unknown>).num_predict = body.max_tokens;
  }

  // Top_p
  if (body.top_p !== undefined) {
    if (!result.options) result.options = {} as Record<string, unknown>;
    (result.options as Record<string, unknown>).top_p = body.top_p;
  }

  // Tools (Ollama supports tools in OpenAI format)
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools;
  }

  // Tool choice
  if (body.tool_choice) {
    result.tool_choice = body.tool_choice;
  }

  return result;
}

/**
 * Normalize messages to Ollama format
 * - Content must be string
 * - tool messages: convert tool_call_id to tool_name
 * - assistant messages: keep tool_calls as-is
 */
function normalizeMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return messages as unknown[];

  const result: Record<string, unknown>[] = [];
  const toolCallMap = new Map<string, string>(); // Map tool_call_id -> tool_name

  // First pass: build tool_call_id -> tool_name map from assistant messages
  for (const msg of messages as Record<string, unknown>[]) {
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls as Record<string, unknown>[]) {
        if (tc.id && (tc.function as Record<string, unknown>)?.name) {
          toolCallMap.set(tc.id as string, (tc.function as Record<string, unknown>).name as string);
        }
      }
    }
  }

  // Second pass: convert messages
  for (const msg of messages as Record<string, unknown>[]) {
    // Handle tool result messages (OpenAI format -> Ollama format)
    if (msg.role === ROLE.TOOL) {
      const toolResult = normalizeContent(msg.content);
      if (!toolResult) continue;

      // Get tool_name from map or use msg.name as fallback
      const toolName = toolCallMap.get(msg.tool_call_id as string) || (msg.name as string) || "unknown_tool";

      result.push({
        role: ROLE.TOOL,
        tool_name: toolName,
        content: toolResult
      });
      continue;
    }

    // Handle assistant messages with tool_calls
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      const content = normalizeContent(msg.content) || "";
      
      // Convert OpenAI tool_calls format to Ollama format
      const ollamaToolCalls = (msg.tool_calls as Record<string, unknown>[]).map((tc: Record<string, unknown>) => ({
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          index: (tc.index as number) || 0,
          name: ((tc.function as Record<string, unknown>)?.name as string) || "",
          arguments: typeof (tc.function as Record<string, unknown>)?.arguments === "string" 
            ? safeParseJSON(((tc.function as Record<string, unknown>).arguments as string) || "{}", {})
            : (tc.function as Record<string, unknown>)?.arguments || {}
        }
      }));

      result.push({
        role: ROLE.ASSISTANT,
        content: content,
        tool_calls: ollamaToolCalls
      });
      continue;
    }

    // Normal messages
    const role = msg.role as string;
    const content = normalizeContent(msg.content);
    const images = extractImagesFromContent(msg.content);

    // Skip empty messages (except assistant)
    if (!content && role !== ROLE.ASSISTANT) continue;

    const out: Record<string, unknown> = {
      role: role,
      content: content
    };

    if (images.length > 0) {
      out.images = images;
    }

    result.push(out);
  }

  return result;
}

/**
 * Normalize content to string
 * Ollama only accepts string content
 */
function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Extract text from content array
    const textParts = content
      .filter((block: unknown) => block && (block as Record<string, unknown>).type === OPENAI_BLOCK.TEXT && (block as Record<string, unknown>).text)
      .map((block: unknown) => (block as Record<string, unknown>).text as string);

    return textParts.join("\n") || "";
  }

  return "";
}

/**
 * Extract base64 images from OpenAI multimodal content blocks.
 * OpenAI image block format:
 *   { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
 * Ollama expects raw base64 strings in message.images[].
 */
function extractImagesFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  const images: string[] = [];

  for (const block of content as Record<string, unknown>[]) {
    if (!block || block.type !== OPENAI_BLOCK.IMAGE_URL) continue;

    const url = typeof block.image_url === "string" ? block.image_url : (block.image_url as Record<string, unknown>)?.url;
    if (typeof url !== "string" || !url) continue;

    const parsed = parseDataUri(url);
    if (!parsed) continue;

    images.push(parsed.base64);
  }

  return images;
}

// Register translator
register(FORMATS.OPENAI, FORMATS.OLLAMA, openaiToOllamaRequest, null);
