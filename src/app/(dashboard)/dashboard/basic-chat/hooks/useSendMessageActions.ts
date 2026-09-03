"use client";

import { useCallback, useState } from "react";
import { textValue } from "../chatFormatUtils";
import type { ChatSession, NormalizedModel } from "../types";
import { exportConversation } from "./exportConversation";
import { prepareRetryMessage } from "./prepareRetryMessage";
import type { SendMessageOptions } from "../types";

export interface UseSendMessageActionsArgs {
  sessions: ChatSession[];
  activeSessionId: string;
  activeModel: NormalizedModel | null;
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  sendMessage: (options?: SendMessageOptions) => Promise<void>;
  isSending: boolean;
  canSend: boolean;
  enterBehavior: "queue" | "steer";
  queueMessage: () => void;
  steerMessage: () => void;
}

export interface UseSendMessageActionsReturn {
  copiedMessageId: string;
  handleCopyMessage: (messageId: string, content: string) => Promise<void>;
  handleRetryMessage: (messageId: string) => void;
  handleFeedback: (messageId: string, feedback: "up" | "down") => void;
  handleExportConversation: (format: "json" | "markdown") => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function useSendMessageActions({
  sessions,
  activeSessionId,
  activeModel,
  updateSession,
  sendMessage,
  isSending,
  canSend,
  enterBehavior,
  queueMessage,
  steerMessage,
}: UseSendMessageActionsArgs): UseSendMessageActionsReturn {
  const [copiedMessageId, setCopiedMessageId] = useState("");

  const handleCopyMessage = useCallback(
    async (messageId: string, content: string) => {
      try {
        await navigator.clipboard.writeText(textValue(content));
        setCopiedMessageId(messageId);
        setTimeout(() => setCopiedMessageId(""), 2000);
      } catch {
        /* Ignore clipboard errors */
      }
    },
    [],
  );

  const handleRetryMessage = useCallback(
    (messageId: string) => {
      const opts = prepareRetryMessage(
        sessions,
        activeSessionId,
        activeModel,
        messageId,
      );
      if (opts) void sendMessage(opts);
    },
    [sessions, activeSessionId, activeModel, sendMessage],
  );

  const handleFeedback = useCallback(
    (messageId: string, feedback: "up" | "down") => {
      updateSession(activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((m) =>
          m.id === messageId
            ? { ...m, feedback: m.feedback === feedback ? null : feedback }
            : m,
        ),
      }));
    },
    [activeSessionId, updateSession],
  );

  const handleExportConversation = useCallback(
    (format: "json" | "markdown") => {
      exportConversation(sessions, activeSessionId, format);
    },
    [sessions, activeSessionId],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (isSending) {
        if (enterBehavior === "steer") steerMessage();
        else queueMessage();
        return;
      }
      if (canSend) void sendMessage();
    },
    [canSend, enterBehavior, isSending, queueMessage, sendMessage, steerMessage],
  );

  return {
    copiedMessageId,
    handleCopyMessage,
    handleRetryMessage,
    handleFeedback,
    handleExportConversation,
    handleKeyDown,
  };
}
