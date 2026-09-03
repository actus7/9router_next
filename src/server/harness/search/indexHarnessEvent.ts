import "server-only";

import type { HarnessEvent } from "@/lib/db/repos/harnessConversationsRepo";
import { upsertHarnessMessageIndex } from "@/lib/db/repos/harnessMessageIndexRepo";

const INDEXED_TYPES = new Set(["user/message", "assistant/message"]);

export async function indexHarnessEventForSearch(event: HarnessEvent): Promise<void> {
  if (!INDEXED_TYPES.has(event.type)) return;
  const content =
    typeof event.data.content === "string" ? event.data.content.trim() : "";
  if (!content) return;
  const messageId =
    typeof event.data.messageId === "string"
      ? event.data.messageId
      : typeof event.data.runId === "string"
        ? event.data.runId
        : `${event.sessionId}-${event.seq}`;
  await upsertHarnessMessageIndex({
    sessionId: event.sessionId,
    messageId,
    role: event.type.startsWith("user/") ? "user" : "assistant",
    content,
    createdAt: event.createdAt,
  });
}
