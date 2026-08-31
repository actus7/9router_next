import { translate } from "@/i18n/runtime";
import { createId, makeSessionTitle } from "../chatFormatUtils";
import type { ChatAttachment, ChatMessage, ChatSession, NormalizedModel } from "../types";

/** Build a user ChatMessage with optional attachments. */
export function createUserMessage(text: string, attachments: ChatAttachment[]): ChatMessage {
  return {
    id: createId(),
    role: "user",
    content: text,
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, type: a.type, dataUrl: a.dataUrl })),
    createdAt: new Date().toISOString(),
  };
}

/** Build a placeholder assistant ChatMessage in "streaming" status. */
export function createAssistantMessage(model: NormalizedModel): ChatMessage {
  return {
    id: createId(),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    status: "streaming",
    modelId: model.id,
    modelName: model.name,
    providerId: model.providerId,
    providerName: model.providerName,
  };
}

/** Merge the new messages into the session list, updating model metadata and auto-titling. */
export function applyNewMessages(
  sessionId: string,
  model: NormalizedModel,
  nextMessages: ChatMessage[],
  userText: string,
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>,
): void {
  setSessions((prev) =>
    prev.map((item) =>
      item.id === sessionId
        ? {
            ...item,
            providerId: model.providerId,
            providerName: model.providerName,
            modelId: model.id,
            modelName: model.name,
            messages: nextMessages,
            updatedAt: new Date().toISOString(),
            title:
              item.title === (translate("New conversation") || "New conversation")
                ? makeSessionTitle(userText)
                : item.title,
          }
        : item,
    ),
  );
}

/** Find an existing session or create one via ensureSessionForModel. */
export function ensureChatSession(
  activeSessionId: string,
  sessions: ChatSession[],
  model: NormalizedModel,
  ensureSessionForModel: (model: NormalizedModel | null) => ChatSession | undefined,
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>,
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>,
): { sessionId: string; session: ChatSession } | null {
  let sessionId = activeSessionId;
  let session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    const newSession = ensureSessionForModel(model);
    if (!newSession) return null;
    session = newSession;
    sessionId = newSession.id;
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(sessionId);
  }
  return { sessionId, session };
}
