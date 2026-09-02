import { buildUserContent } from "../chatFormatUtils";
import type { ChatMessage, NormalizedModel } from "../types";

type ToolDefinition = Record<string, unknown>;

/** Filter out the placeholder assistant message and map to API format. */
export function buildRequestMessages(
  messages: ChatMessage[],
  assistantMessageId: string,
  systemPrompt: string,
): Array<Record<string, unknown>> {
  const result = messages
    .filter((m) => !(m.role === "assistant" && m.id === assistantMessageId))
    .map((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      if (m.role === "tool") {
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      }
      return { role: m.role, content: m.role === "user" ? buildUserContent(m) : m.content };
    });

  if (systemPrompt.trim()) {
    result.unshift({ role: "system", content: systemPrompt.trim() });
  }

  return result;
}

/** Build the fetch init object for the streaming chat completions endpoint. */
export function buildChatFetchOptions(
  model: NormalizedModel,
  requestMessages: Array<Record<string, unknown>>,
  temperature: number,
  apiKey: string,
  signal: AbortSignal,
  tools?: readonly ToolDefinition[],
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
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    }),
    signal,
  };
}
