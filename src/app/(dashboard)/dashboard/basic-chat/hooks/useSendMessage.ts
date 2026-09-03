"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SendMessageOptions } from "../types";
import { executeSendMessage } from "./executeSendMessage";
import { useSendMessageActions } from "./useSendMessageActions";
import { useSendMessageQueue } from "./useSendMessageQueue";
import type {
  AgentActivity,
  UseSendMessageArgs,
  UseSendMessageReturn,
} from "./useSendMessageTypes";

export type { UseSendMessageReturn } from "./useSendMessageTypes";

// Owns the streaming chat request lifecycle: building the request, reading
// the SSE stream into the active session's assistant message, retry/stop/
// feedback/export actions, and the transient error/streaming UI state.
export function useSendMessage({
  activeModel,
  activeProviderGroup,
  activeSessionId,
  setActiveSessionId,
  sessions,
  setSessions,
  updateSession,
  ensureSessionForModel,
  draft,
  setDraft,
  attachments,
  setAttachments,
  systemPrompt,
  temperature,
  reasoningEffort,
  enterBehavior,
  apiKey,
  recordHarnessEvent,
}: UseSendMessageArgs): UseSendMessageReturn {
  const [chatError, setChatError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [liveActivities, setLiveActivities] = useState<AgentActivity[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const sessionsRef = useRef(sessions);
  const activityClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sendMessageRef = useRef<
    ((options?: SendMessageOptions) => Promise<void>) | null
  >(null);

  const queue = useSendMessageQueue({
    isSending,
    draft,
    attachments,
    setDraft,
    setAttachments,
    abortRef,
  });
  const { queuedReplayTimerRef } = queue;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Navigating away mid-stream must not leave the request running or keep
  // updating state on an unmounted component.
  useEffect(() => {
    const abort = abortRef;
    const activityTimer = activityClearTimerRef;
    const queueTimer = queuedReplayTimerRef;
    return () => {
      abort.current?.abort();
      if (activityTimer.current) clearTimeout(activityTimer.current);
      if (queueTimer.current) clearTimeout(queueTimer.current);
    };
  }, [queuedReplayTimerRef]);

  const canSend =
    !isSending &&
    !!activeModel &&
    (draft.trim().length > 0 || attachments.length > 0);

  const resetStream = useCallback(() => {
    if (activityClearTimerRef.current)
      clearTimeout(activityClearTimerRef.current);
    activityClearTimerRef.current = null;
    queue.clearQueue();
    setStreamingMessageId("");
    setStreamingText("");
    setLiveActivities([]);
  }, [queue]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const replayQueuedMessage = useCallback(
    (item: { text: string; attachments: typeof attachments }) => {
      queuedReplayTimerRef.current = setTimeout(() => {
        void sendMessageRef.current?.({
          text: item.text,
          attachments: item.attachments,
        });
      }, 0);
    },
    [queuedReplayTimerRef],
  );

  const sendMessage = useCallback(
    async (options?: SendMessageOptions) => {
      await executeSendMessage({
        options,
        activeModel,
        activeProviderGroup,
        activeSessionId,
        setActiveSessionId,
        sessionsRef,
        setSessions,
        ensureSessionForModel,
        draft,
        setDraft,
        attachments,
        setAttachments,
        systemPrompt,
        temperature,
        reasoningEffort,
        apiKey,
        recordHarnessEvent,
        updateSession,
        abortRef,
        setChatError,
        setIsSending,
        setStreamingMessageId,
        setStreamingText,
        setLiveActivities,
        activityClearTimerRef,
        dequeueNext: queue.dequeueNext,
        replayQueuedMessage,
      });
    },
    [
      activeModel,
      activeProviderGroup,
      draft,
      attachments,
      activeSessionId,
      ensureSessionForModel,
      setSessions,
      setActiveSessionId,
      recordHarnessEvent,
      setDraft,
      setAttachments,
      systemPrompt,
      temperature,
      reasoningEffort,
      apiKey,
      updateSession,
      queue.dequeueNext,
      replayQueuedMessage,
    ],
  );

  sendMessageRef.current = sendMessage;

  const actions = useSendMessageActions({
    sessions,
    activeSessionId,
    activeModel,
    updateSession,
    sendMessage,
    isSending,
    canSend,
    enterBehavior,
    queueMessage: queue.queueMessage,
    steerMessage: queue.steerMessage,
  });

  return {
    chatError,
    setChatError,
    isSending,
    streamingMessageId,
    streamingText,
    liveActivities,
    copiedMessageId: actions.copiedMessageId,
    canSend,
    canQueue: queue.canQueue,
    queuedMessages: queue.queuedMessages,
    sendMessage,
    queueMessage: queue.queueMessage,
    steerMessage: queue.steerMessage,
    cancelQueuedMessage: queue.cancelQueuedMessage,
    moveQueuedMessage: queue.moveQueuedMessage,
    handleStop,
    resetStream,
    handleCopyMessage: actions.handleCopyMessage,
    handleRetryMessage: actions.handleRetryMessage,
    handleFeedback: actions.handleFeedback,
    handleExportConversation: actions.handleExportConversation,
    handleKeyDown: actions.handleKeyDown,
  };
}
