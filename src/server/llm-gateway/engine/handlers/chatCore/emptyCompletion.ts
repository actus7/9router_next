interface JsonObject { [key: string]: unknown }

/**
 * True when an OpenAI-shaped chat completion has no assistant-visible output
 * at all: no text, no tool calls, no reasoning. A provider that answers 200
 * with this shape (e.g. a broken AI Horde volunteer worker returning
 * `content: ""`) is a failure wearing a success status, not a legitimately
 * empty turn — a genuinely empty turn from a reasoning model still carries
 * `reasoning_content`, which this treats as non-empty on purpose.
 */
export function isEmptyChatCompletion(response: JsonObject): boolean {
  const choices = response?.choices as JsonObject[] | undefined;
  if (!Array.isArray(choices) || choices.length === 0) return false;

  return choices.every((choice) => {
    const message = choice?.message as JsonObject | undefined;
    if (!message) return true;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content.trim() : "";
    return content.length === 0 && toolCalls.length === 0 && reasoning.length === 0;
  });
}
