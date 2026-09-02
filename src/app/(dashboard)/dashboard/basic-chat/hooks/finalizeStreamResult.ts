import { translate } from "@/i18n/runtime";
import { makeSessionTitle, textValue } from "../chatFormatUtils";
import type { ChatSession, MessageTiming, TokenUsage } from "../types";

type UpdateSessionFn = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
type RecordEventFn = (sessionId: string, type: string, data: Record<string, unknown>) => void;

export interface StreamTelemetry {
  reasoning?: string;
  usage?: TokenUsage | null;
  responseSource?: "synapse" | null;
  timing?: MessageTiming | null;
}

/** Persist the final assistant text, record the run/end event, and update the session title. */
export function finalizeStreamSuccess(
  sessionId: string,
  assistantMessageId: string,
  assistantText: string,
  userText: string,
  updateSession: UpdateSessionFn,
  recordHarnessEvent: RecordEventFn,
  telemetry: StreamTelemetry = {},
): void {
  updateSession(sessionId, (current) => ({
    ...current,
    messages: current.messages.map((m) =>
      m.id === assistantMessageId ? { ...m, content: assistantText || m.content, status: "done" as const, tokenUsage: telemetry.usage ?? m.tokenUsage, timing: telemetry.timing ?? m.timing, responseSource: telemetry.responseSource !== undefined ? telemetry.responseSource : m.responseSource, reasoning: telemetry.reasoning || m.reasoning } : m,
    ),
    updatedAt: new Date().toISOString(),
  }));
  if (telemetry.reasoning) {
    recordHarnessEvent(sessionId, "assistant/reasoning", { runId: assistantMessageId, content: telemetry.reasoning });
  }
  recordHarnessEvent(sessionId, "run/end", {
    runId: assistantMessageId,
    status: "completed",
    messageId: assistantMessageId,
    ...(telemetry.usage ? { usage: telemetry.usage } : {}),
  });
  const title = makeSessionTitle(userText);
  updateSession(sessionId, (session) => ({
    ...session,
    title: session.title === (translate("New conversation") || "New conversation") ? title : session.title,
    updatedAt: new Date().toISOString(),
  }));
}

/** Mark the assistant message as errored and only retire a definitively missing model. */
export function finalizeStreamError(
  sessionId: string,
  assistantMessageId: string,
  error: unknown,
  updateSession: UpdateSessionFn,
  recordHarnessEvent: RecordEventFn,
  setChatError: (msg: string) => void,
): void {
  if ((error as Error).name === "AbortError") return;

  const errorText = textValue((error as Error)?.message || error);
  updateSession(sessionId, (current) => ({
    ...current,
    messages: current.messages.map((m) =>
      m.id === assistantMessageId
        ? { ...m, content: m.content || `Error: ${errorText}`, status: "error" as const }
        : m,
    ),
    updatedAt: new Date().toISOString(),
  }));
  setChatError(errorText || "Failed to send message.");
  recordHarnessEvent(sessionId, "run/end", { runId: assistantMessageId, status: "failed", error: errorText });

}
