import { textValue } from "../chatFormatUtils";
import type { ChatSession } from "../types";

/** Download the active session as JSON or Markdown. */
export function exportConversation(
  sessions: ChatSession[],
  activeSessionId: string,
  format: "json" | "markdown",
): void {
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session) return;

  let content: string;
  let filename: string;
  let mimeType: string;

  if (format === "json") {
    content = JSON.stringify(session, null, 2);
    filename = `${session.title.replace(/[^a-z0-9]/gi, "_")}.json`;
    mimeType = "application/json";
  } else {
    content = `# ${session.title}\n\n`;
    content += `Latest model: ${session.modelName} (${session.providerName})\n`;
    content += `Created: ${new Date(session.createdAt).toLocaleString()}\n\n---\n\n`;
    for (const msg of session.messages) {
      const role = msg.role === "user" ? "**You**" : `**${msg.modelName || session.modelName}**`;
      content += `${role}:\n${textValue(msg.content)}\n\n`;
    }
    filename = `${session.title.replace(/[^a-z0-9]/gi, "_")}.md`;
    mimeType = "text/markdown";
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
