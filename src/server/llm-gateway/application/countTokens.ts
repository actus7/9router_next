// Input-token estimate for token-counting endpoints. Lives in the gateway, not
// in the route, so any protocol's count endpoint (Anthropic's
// `/v1/messages/count_tokens`, Gemini's `:countTokens`) can answer from one
// estimator instead of each route growing its own.

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
  return countContentChars((message as Record<string, unknown>).content);
}

/**
 * Estimates the input tokens of an Anthropic Messages body (`system`, `tools`,
 * `messages`) at ~4 characters per token, with fixed costs for image and
 * non-text document blocks.
 *
 * An estimate, not a tokenizer: it exists so clients that budget context
 * (Claude Code) get a number of the right magnitude without a provider call.
 * Another protocol reuses it by mapping its body onto this shape first — e.g.
 * Gemini `contents[].parts` → `messages[].content` blocks.
 */
export function estimateAnthropicInputTokens(body: Record<string, unknown> = {}): number {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let totalChars = countValueChars(body.system) + countValueChars(body.tools);

  for (const msg of messages) {
    totalChars += countMessageChars(msg);
  }

  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}
