import { buildUserContent } from "../chatFormatUtils";
import type { ChatMessage, NormalizedModel } from "../types";

/** Filter out the placeholder assistant message and map to API format. */
export function buildRequestMessages(
  messages: ChatMessage[],
  assistantMessageId: string,
  systemPrompt: string,
): Array<{ role: string; content: unknown }> {
  const result = messages
    .filter((m) => !(m.role === "assistant" && m.id === assistantMessageId))
    .map((m) => ({
      role: m.role,
      content: m.role === "user" ? buildUserContent(m) : m.content,
    }));

  if (systemPrompt.trim()) {
    result.unshift({ role: "system", content: systemPrompt.trim() });
  }

  return result;
}

/** Build the fetch init object for the streaming chat completions endpoint. */
export function buildChatFetchOptions(
  model: NormalizedModel,
  requestMessages: Array<{ role: string; content: unknown }>,
  temperature: number,
  apiKey: string,
  signal: AbortSignal,
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model.requestModel || model.id,
      messages: requestMessages,
      stream: true,
      temperature,
    }),
    signal,
  };
}
