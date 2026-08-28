import { NextRequest } from "next/server";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

function countValueChars(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countValueChars(item), 0);
  }
  if (typeof value === "object") {
    return Object.entries(value).reduce((total, [key, item]) => {
      return total + key.length + countValueChars(item);
    }, 0);
  }
  return 0;
}

function countContentBlockChars(block: unknown): number {
  if (block == null) return 0;
  if (typeof block === "string") return block.length;
  if (typeof block !== "object") return countValueChars(block);

  const b = block as Record<string, unknown>;
  switch (b.type) {
    case "text":
      return countValueChars(b.text);
    case "tool_use":
      return countValueChars(b.name) + countValueChars(b.input);
    case "tool_result":
      return countValueChars(b.content);
    case "thinking":
      return countValueChars(b.thinking);
    default:
      return countValueChars(block);
  }
}

function countMessageChars(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const content = (message as Record<string, unknown>).content;

  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((total, block) => total + countContentBlockChars(block), 0);
  }
  return countValueChars(content);
}

export function estimateAnthropicInputTokens(body: Record<string, unknown> = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let totalChars = countValueChars(body.system) + countValueChars(body.tools);

  for (const msg of messages) {
    totalChars += countMessageChars(msg);
  }

  return Math.ceil(totalChars / 4);
}

/**
 * POST /v1/messages/count_tokens - Mock token count response
 */
export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  const inputTokens = estimateAnthropicInputTokens(body);

  return new Response(JSON.stringify({
    input_tokens: inputTokens
  }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

