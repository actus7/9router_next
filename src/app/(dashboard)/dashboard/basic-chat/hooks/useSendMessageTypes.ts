import type { ChatAttachment, ChatSession, NormalizedModel, ProviderGroup, SendMessageOptions } from "../types";

export interface UseSendMessageArgs {
  activeModel: NormalizedModel | null;
  activeProviderGroup: ProviderGroup | null;
  activeSessionId: string;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
  ensureSessionForModel: (model: NormalizedModel | null) => ChatSession | undefined;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  attachments: ChatAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  systemPrompt: string;
  temperature: number;
  apiKey: string;
  recordHarnessEvent: (sessionId: string, type: string, data: Record<string, unknown>) => void;
  setBlockedModelIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseSendMessageReturn {
  chatError: string;
  setChatError: React.Dispatch<React.SetStateAction<string>>;
  isSending: boolean;
  streamingMessageId: string;
  streamingText: string;
  copiedMessageId: string;
  canSend: boolean;
  sendMessage: (options?: SendMessageOptions) => Promise<void>;
  handleStop: () => void;
  resetStream: () => void;
  handleCopyMessage: (messageId: string, content: string) => Promise<void>;
  handleRetryMessage: (messageId: string) => void;
  handleFeedback: (messageId: string, feedback: "up" | "down") => void;
  handleExportConversation: (format: "json" | "markdown") => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}
