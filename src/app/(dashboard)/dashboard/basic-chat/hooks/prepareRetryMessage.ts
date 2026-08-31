import { textValue } from "../chatFormatUtils";
import type { ChatSession, NormalizedModel, SendMessageOptions } from "../types";

/**
 * Look up the user message that precedes `messageId` and return the
 * SendMessageOptions needed to replay it, or null if not found.
 */
export function prepareRetryMessage(
  sessions: ChatSession[],
  activeSessionId: string,
  activeModel: NormalizedModel | null,
  messageId: string,
): SendMessageOptions | null {
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session || !activeModel) return null;

  const msgIndex = session.messages.findIndex((m) => m.id === messageId);
  if (msgIndex < 0) return null;

  const userIndex = [...session.messages.slice(0, msgIndex)]
    .map((m) => m.role)
    .lastIndexOf("user");
  const userMsg = userIndex >= 0 ? session.messages[userIndex] : undefined;
  if (!userMsg || userMsg.role !== "user") return null;

  return {
    text: textValue(userMsg.content),
    attachments: userMsg.attachments,
    baseMessages: session.messages.slice(0, userIndex),
  };
}
