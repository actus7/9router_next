import type { ChatAttachment, ChatSession, NormalizedModel, ProviderGroup, SendMessageOptions } from "../types";

export interface AgentActivity {
  id: string;
  label: string;
  detail?: string;
  state: "running" | "streaming" | "done" | "error";
}

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
}

export interface UseSendMessageReturn {
  chatError: string;
  setChatError: React.Dispatch<React.SetStateAction<string>>;
  isSending: boolean;
  streamingMessageId: string;
  streamingText: string;
  liveActivities: AgentActivity[];
  copiedMessageId: string;
  canSend: boolean;
  canQueue: boolean;
  queuedMessage: string;
  sendMessage: (options?: SendMessageOptions) => Promise<void>;
  queueMessage: () => void;
  handleStop: () => void;
  resetStream: () => void;
  handleCopyMessage: (messageId: string, content: string) => Promise<void>;
  handleRetryMessage: (messageId: string) => void;
  handleFeedback: (messageId: string, feedback: "up" | "down") => void;
  handleExportConversation: (format: "json" | "markdown") => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}
