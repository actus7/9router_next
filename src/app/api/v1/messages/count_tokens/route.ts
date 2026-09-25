import { gatewayRoute } from "@/server/application/http/gatewayRoute";
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

// Images/PDFs are billed by pixels/pages, not by their base64 length — counting
// the characters made a 1MB screenshot ~250k tokens. Fixed per-block estimates
// (Anthropic: ~1600 tokens for a typical image), expressed in chars for the /4 below.
const IMAGE_TOKENS_ESTIMATE = 1600;
const DOCUMENT_TOKENS_ESTIMATE = 3000;
const CHARS_PER_TOKEN = 4;

function countContentChars(content: unknown): number {
  return Array.isArray(content)
    ? content.reduce((total, block) => total + countContentBlockChars(block), 0)
    : countValueChars(content);
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
      return countContentChars(b.content);
    case "image":
      return IMAGE_TOKENS_ESTIMATE * CHARS_PER_TOKEN;
    case "document": {
      // A plain-text document is its text; anything else (base64 PDF, URL) is opaque.
      const source = b.source as Record<string, unknown> | undefined;
      return source?.type === "text" ? countValueChars(source.data) : DOCUMENT_TOKENS_ESTIMATE * CHARS_PER_TOKEN;
    }
    case "thinking":
      return countValueChars(b.thinking);
    default:
      return countValueChars(block);
  }
}

function countMessageChars(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const content = (message as Record<string, unknown>).content;

  return countContentChars(content);
}

function estimateAnthropicInputTokens(body: Record<string, unknown> = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let totalChars = countValueChars(body.system) + countValueChars(body.tools);

  for (const msg of messages) {
    totalChars += countMessageChars(msg);
  }

  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

/**
 * POST /v1/messages/count_tokens - Mock token count response
 */
async function handlePOST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } }), {
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

export const POST = gatewayRoute(handlePOST);
