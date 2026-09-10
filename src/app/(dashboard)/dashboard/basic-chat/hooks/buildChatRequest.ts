import { buildUserContent } from "../chatFormatUtils";
import type { ChatMessage, NormalizedModel } from "../types";

type ToolDefinition = object;

/**
 * Filter out the placeholder assistant message and map to API format.
 *
 * Tool calls nothing answered are dropped rather than serialized. The browser
 * loop stops at 8 steps and a tab can die between them, so an assistant turn
 * can keep calls with no matching `role: "tool"` message. Sent as-is, the
 * gateway backfills empty results (`translator/concerns/toolCall.ts`) and the
 * model reads a blank answer it is never told is blank — and a turn left with
 * only unanswered calls carries no content at all, so it is dropped whole.
 */
export function buildRequestMessages(
  messages: ChatMessage[],
  assistantMessageId: string,
  systemPrompt: string,
): Array<Record<string, unknown>> {
  const answered = new Set(
    messages.filter((m) => m.role === "tool" && m.toolCallId).map((m) => m.toolCallId),
  );
  const result = messages
    .filter((m) => !(m.role === "assistant" && m.id === assistantMessageId))
    .flatMap((m) => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        const calls = m.toolCalls.filter((call) => answered.has(call.id));
        if (calls.length === 0) {
          return m.content ? [{ role: "assistant", content: m.content }] : [];
        }
        return [{
          role: "assistant",
          content: m.content || null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        }];
      }
      if (m.role === "tool") {
        return [{ role: "tool", tool_call_id: m.toolCallId, content: m.content }];
      }
      return [{ role: m.role, content: m.role === "user" ? buildUserContent(m) : m.content }];
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
  reasoningEffort?: "low" | "medium" | "high" | null,
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
      stream_options: { include_usage: true },
      temperature,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    }),
    signal,
  };
}
