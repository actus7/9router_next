import { textValue } from "../chatFormatUtils";
import type { ChatSession } from "../types";

/**
 * 👎 or "Regenerate" on an answer Synapse served tells the Synapse Loop that
 * answer was wrong. Keyed by the user's question — the server finds the learned
 * capability from it. A no-op for answers the model wrote.
 */
export function rejectSynapseAnswer(session: ChatSession | undefined, messageId: string): void {
  if (!session) return;
  const index = session.messages.findIndex((m) => m.id === messageId);
  if (index < 0 || !session.messages[index].tokenSavers?.includes("synapse")) return;
  const question = session.messages.slice(0, index).reverse().find((m) => m.role === "user");
  const input = textValue(question?.content ?? "").trim();
  if (!input) return;
  void fetch("/api/synapse/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  }).catch(() => undefined);
}
