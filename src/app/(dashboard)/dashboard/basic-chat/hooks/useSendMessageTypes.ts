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

/**
 * Everything a single send owns, handed to it once its conversation is known.
 *
 * These were one set of refs and setters on the hook, which is what made the
 * client single-file: a second send aborted the first one's controller, took
 * over its run id, and streamed its tokens into whatever was on screen. A ref
 * is just an object with a `current`, so scoping them per conversation costs
 * the send nothing — it reads the same names it always did.
 */
export interface SendScope {
  abortRef: React.MutableRefObject<AbortController | null>;
  activeRunIdRef: React.MutableRefObject<string | null>;
  stopRequestedRef: React.MutableRefObject<boolean>;
  setStreamingMessageId: React.Dispatch<React.SetStateAction<string>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  setLiveActivities: React.Dispatch<React.SetStateAction<AgentActivity[]>>;
  /** Marks this conversation as working, or done. Not the page. */
  setSending: (sending: boolean) => void;
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
  /** A send is in flight in some conversation, not necessarily this one. */
  isSending: boolean;
  /** A send is in flight in *this* conversation. What the composer reads. */
  isBusy: boolean;
  /** The conversation the most recent send went into — whose error is shown. */
  sendingSessionId: string;
  /**
   * Whether a run is already being watched by a live send.
   *
   * Was a single ref holding the one run id this tab watched. Several sends can
   * be in flight now, so recovery has to ask rather than compare.
   */
  isRunWatched: (runId: string) => boolean;
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
