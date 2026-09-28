/**
 * `:countTokens` estimate. No provider is called: the model behind a gateway
 * alias may not have a counting endpoint at all, and gemini-cli calls this
 * often. Same chars/4 heuristic as the Anthropic `count_tokens` route, and the
 * same rule that media is priced as a block, not by its base64 length — a
 * screenshot counted by characters read as ~250k tokens.
 */

type Json = Record<string, unknown>;

const CHARS_PER_TOKEN = 4;
// Gemini bills an image at 258 tokens per 768px tile; a typical screenshot is a few tiles.
const MEDIA_TOKENS_ESTIMATE = 1032;

function countChars(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value !== "object") return String(value).length;
  if (Array.isArray(value)) return value.reduce((n, item) => n + countChars(item), 0);
  return Object.entries(value).reduce((n, [key, item]) => n + key.length + countChars(item), 0);
}

function countPart(part: Json): number {
  if (part.inlineData || part.fileData) return MEDIA_TOKENS_ESTIMATE * CHARS_PER_TOKEN;
  if (typeof part.text === "string") return part.text.length;
  return countChars(part);
}

function countContents(contents: unknown): number {
  if (!Array.isArray(contents)) return 0;
  return contents.reduce((n, content: Json) => {
    const parts = Array.isArray(content?.parts) ? (content.parts as Json[]) : [];
    return n + parts.reduce((m, part) => m + countPart(part || {}), 0);
  }, 0);
}

export function countGeminiTokens(body: Json): number {
  // The API accepts either `contents` or a full `generateContentRequest`.
  const request = (body.generateContentRequest as Json | undefined) || body;
  const systemParts = (request.systemInstruction as Json | undefined)?.parts;
  const chars = countContents(request.contents)
    + countContents(systemParts ? [{ parts: systemParts }] : [])
    + countChars(request.tools);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}
