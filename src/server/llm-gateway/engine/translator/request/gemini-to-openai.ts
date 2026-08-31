import { register } from "../registry";
import { FORMATS } from "../formats";
import { adjustMaxTokens } from "../formats/maxTokens";
import { encodeDataUri } from "../concerns/image";
import { collapseTextParts } from "../concerns/message";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index";

// Convert Gemini request to OpenAI format
function geminiToOpenAIRequest(model: string, body: Record<string, unknown>, stream: boolean) {
  const result: { messages: Record<string, unknown>[]; [key: string]: unknown } = {
    model: model,
    messages: [],
    stream: stream
  };

  // Generation config
  if (body.generationConfig) {
    const config = body.generationConfig as Record<string, unknown>;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: body.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
  }

  // System instruction
  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemText
      });
    }
  }

  // Convert contents to messages
  if (body.contents && Array.isArray(body.contents)) {
    for (const content of body.contents) {
      const converted = convertGeminiContent(content as Record<string, unknown>);
      if (converted) {
        result.messages.push(converted);
      }
    }
  }

  // Tools
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [] as Record<string, unknown>[];
    for (const tool of body.tools as Record<string, unknown>[]) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations as Record<string, unknown>[]) {
          (result.tools as Record<string, unknown>[]).push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parameters || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  return result;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content: Record<string, unknown>): Record<string, unknown> | null {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
  
  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts: Record<string, unknown>[] = [];
  const toolCalls: Record<string, unknown>[] = [];

  for (const part of content.parts as Record<string, unknown>[]) {
    if (part.text !== undefined) {
      parts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    if (part.inlineData) {
      const inlineData = part.inlineData as Record<string, unknown>;
      parts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(inlineData.mimeType as string, inlineData.data as string)
        }
      });
    }

    if (part.functionCall) {
      const fc = part.functionCall as Record<string, unknown>;
      // Gemini lacks a native call id; derive a deterministic one from the name so the
      // matching functionResponse maps to the same tool_call_id (providers require pairing).
      toolCalls.push({
        id: fc.id || `call_${fc.name}`,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args || {})
        }
      });
    }

    if (part.functionResponse) {
      const fr = part.functionResponse as Record<string, unknown>;
      const response = fr.response as Record<string, unknown> | undefined;
      return {
        role: ROLE.TOOL,
        tool_call_id: fr.id || `call_${fr.name}`,
        content: JSON.stringify(response?.result || response || {})
      };
    }
  }

  if (toolCalls.length > 0) {
    const result: Record<string, unknown> = { role: ROLE.ASSISTANT };
    if (parts.length > 0) {
      result.content = parts.length === 1 ? parts[0].text : parts;
    }
    result.tool_calls = toolCalls;
    return result;
  }

  if (parts.length > 0) {
    return {
      role,
      content: collapseTextParts(parts)
    };
  }

  return null;
}

// Extract text from Gemini content
function extractGeminiText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (c.parts && Array.isArray(c.parts)) {
      return (c.parts as Record<string, unknown>[]).map((p: Record<string, unknown>) => (p.text as string) || "").join("");
    }
  }
  return "";
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
