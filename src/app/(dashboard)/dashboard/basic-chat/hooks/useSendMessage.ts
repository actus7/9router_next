"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { stopDurableRun } from "./executeDurableChat";
import type { SendMessageOptions } from "../types";
import { executeSendMessage } from "./executeSendMessage";
import { useSendMessageActions } from "./useSendMessageActions";
import { useSendMessageQueue } from "./useSendMessageQueue";
import type {
  AgentActivity,
  QueuedMessage,
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
  // The durable run in flight. Pressing stop has to reach the server, because
  // aborting locally now only stops watching — the work is no longer here.
  const activeRunIdRef = useRef<string | null>(null);
  // Stop pressed while `POST /api/harness/runs` was still in flight, so there
  // was no run id to send it to yet.
  const stopRequestedRef = useRef(false);
  const sessionsRef = useRef(sessions);
  const activityClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sendMessageRef = useRef<
    ((options?: SendMessageOptions) => Promise<void>) | null
  >(null);

  // Stop and steer both mean "this run is over". Aborting locally only stops
  // watching — the work moved to the server — so both have to tell it.
  const interrupt = useCallback(() => {
    const runId = activeRunIdRef.current;
    if (runId) void stopDurableRun(runId);
    // No id yet: the send is between its POST and the answer that names the
    // run. Remembered so it is stopped the moment it has a name.
    else stopRequestedRef.current = true;
    abortRef.current?.abort();
  }, []);

  const queue = useSendMessageQueue({
    isSending,
    activeSessionId,
    draft,
    attachments,
    setDraft,
    setAttachments,
    interrupt,
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
    setStreamingMessageId("");
    setStreamingText("");
    setLiveActivities([]);
    // The banner belongs to the run that failed. It used to be cleared only by
    // the *next* send, so a provider error survived "new chat" and sat above an
    // empty conversation as if the fresh one had already failed.
    setChatError("");
  }, []);

  // Same staleness by the other route: switching conversations left the
  // previous one's error on screen. The banner is page-level state, so it has
  // to follow the active session rather than the send lifecycle alone.
  useEffect(() => {
    setChatError("");
  }, [activeSessionId]);

  // Deliberately asymmetric with the unmount cleanup above: leaving the screen
  // aborts the watcher and lets the run finish on the server, while pressing
  // stop means stop, so it tells the server first.
  const handleStop = interrupt;

  const replayQueuedMessage = useCallback(
    (item: QueuedMessage) => {
      // A queued follow-up belongs to the conversation it was typed into. The
      // send ahead of it can take minutes — it outlives the tab — so by now the
      // user may be reading something else, and `sendMessage` closes over
      // whatever is open *now*. It carries its own session so the replay lands
      // where it was typed; requeueing it instead stranded it forever, because
      // the queue is only drained in the send's `finally`, which already ran.
      queuedReplayTimerRef.current = setTimeout(() => {
        void sendMessageRef.current?.({
          text: item.text,
          attachments: item.attachments,
          sessionId: item.sessionId || undefined,
        });
      }, 0);
    },
    [queuedReplayTimerRef],
  );

  const sendMessage = useCallback(
    async (options?: SendMessageOptions) => {
      // A fresh send never inherits a stop aimed at the previous one.
      stopRequestedRef.current = false;
      activeRunIdRef.current = null;
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
        activeRunIdRef,
        stopRequestedRef,
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
