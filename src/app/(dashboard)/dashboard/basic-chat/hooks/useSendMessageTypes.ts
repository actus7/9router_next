import type {
  ChatAttachment,
  ChatSession,
  NormalizedModel,
  ProviderGroup,
  SendMessageOptions,
} from "../types";

export interface AgentActivity {
  id: string;
  label: string;
  detail?: string;
  state: "running" | "streaming" | "done" | "error";
}

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: ChatAttachment[];
  /** The conversation it was typed into. Replay must not guess this. */
  sessionId: string;
  /** The model it was typed against, for the same reason. */
  model: NormalizedModel | null;
}

export interface UseSendMessageArgs {
  activeModel: NormalizedModel | null;
  activeProviderGroup: ProviderGroup | null;
  activeSessionId: string;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  ensureSessionForModel: (
    model: NormalizedModel | null,
  ) => ChatSession | undefined;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  attachments: ChatAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  systemPrompt: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high" | null;
  enterBehavior: "queue" | "steer";
  apiKey: string;
  recordHarnessEvent: (
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
  ) => void;
}

export interface UseSendMessageReturn {
  chatError: string;
  setChatError: React.Dispatch<React.SetStateAction<string>>;
  /** A send is in flight somewhere — the client runs one at a time. */
  isSending: boolean;
  /** That send belongs to the conversation on screen. What the composer reads. */
  isBusy: boolean;
  /** The conversation the in-flight send went into — empty before the first. */
  sendingSessionId: string;
  /** The durable run this tab is watching, so recovery does not watch it too. */
  watchedRunIdRef: React.MutableRefObject<string | null>;
  streamingMessageId: string;
  streamingText: string;
  liveActivities: AgentActivity[];
  copiedMessageId: string;
  canSend: boolean;
  canQueue: boolean;
  queuedMessages: QueuedMessage[];
  sendMessage: (options?: SendMessageOptions) => Promise<void>;
  queueMessage: () => void;
  steerMessage: () => void;
  cancelQueuedMessage: (id: string) => void;
  moveQueuedMessage: (id: string, direction: "up" | "down") => void;
  handleStop: () => void;
  resetStream: () => void;
  handleCopyMessage: (messageId: string, content: string) => Promise<void>;
  handleRetryMessage: (messageId: string) => void;
  handleFeedback: (messageId: string, feedback: "up" | "down") => void;
  handleExportConversation: (format: "json" | "markdown") => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}
