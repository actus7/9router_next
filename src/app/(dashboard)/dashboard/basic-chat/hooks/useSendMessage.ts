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
  // A run outlives the tab, so reading another conversation while one answers
  // is the normal case. Without an owner the "agent working" card followed the
  // reader and claimed whatever was on screen was busy.
  const [sendingSessionId, setSendingSessionId] = useState("");
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

  /**
   * Whether *this* conversation is the one working.
   *
   * `isSending` is a fact about the client — it runs one send at a time — and
   * every composer control was reading it directly, so "Stop" and the queue
   * button appeared on every conversation while any one of them worked. Stop
   * pressed in a conversation with nothing running killed the run in another.
   */
  const isBusy = isSending && sendingSessionId === activeSessionId;

  const queue = useSendMessageQueue({
    isSending: isBusy,
    activeSessionId,
    activeModel,
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
    const queueTimer = queuedReplayTimerRef;
    return () => {
      abort.current?.abort();
      if (queueTimer.current) clearTimeout(queueTimer.current);
    };
  }, [queuedReplayTimerRef]);

  /**
   * Takes the card down once there is nothing left to say.
   *
   * This used to be a timer the send scheduled in its own `finally`, which made
   * the card's lifetime the responsibility of every exit path — and a path that
   * skipped it (a replayed queue item, a throw before the request was even
   * built) left the card frozen on screen, still naming what it had been doing,
   * until the user reloaded the page. The condition is just "no send in flight
   * and something still shown", so it is derived here and the pause before it
   * goes is long enough to read the last state.
   */
  /**
   * A follow-up cannot outlive the conversation it was typed into.
   *
   * Deleting one while its run was still going left the message queued for a
   * conversation that no longer existed: undeliverable, and invisible because
   * the bar only shows the open conversation's.
   */
  const { pruneQueue } = queue;
  useEffect(() => {
    pruneQueue(sessions.map((session) => session.id));
  }, [pruneQueue, sessions]);

  useEffect(() => {
    if (isSending || liveActivities.length === 0) return;
    const timer = setTimeout(() => setLiveActivities([]), 900);
    return () => clearTimeout(timer);
  }, [isSending, liveActivities]);

  const canSend =
    !isSending &&
    !!activeModel &&
    (draft.trim().length > 0 || attachments.length > 0);

  const resetStream = useCallback(() => {
    setStreamingMessageId("");
    setStreamingText("");
    setLiveActivities([]);
    // The banner belongs to the run that failed. It used to be cleared only by
    // the *next* send, so a provider error survived "new chat" and sat above an
    // empty conversation as if the fresh one had already failed.
    setChatError("");
  }, []);

  // The banner used to be wiped on every conversation change, which hid the
  // staleness without fixing it: a run that failed minutes after the reader
  // moved on still painted its error over whichever conversation was open, and
  // coming back to the one that actually failed erased the message. It is
  // scoped by owner at the render instead — see `BasicChatPageClient`.

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
          model: item.model ?? undefined,
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
      try {
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
          setSendingSessionId,
          setStreamingMessageId,
          setStreamingText,
          setLiveActivities,
          dequeueNext: queue.dequeueNext,
          replayQueuedMessage,
        });
      } catch (error) {
        // `executeSendMessage` guards the request, but it turns `isSending` on
        // long before that guard — everything that builds the request runs
        // outside it. A throw there left the composer disabled and the card
        // frozen until the page was reloaded, with nothing said about why.
        setChatError(error instanceof Error ? error.message : "The send failed.");
        setIsSending(false);
      }
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
    isSending: isBusy,
    canSend,
    enterBehavior,
    queueMessage: queue.queueMessage,
    steerMessage: queue.steerMessage,
  });

  return {
    chatError,
    setChatError,
    isSending,
    isBusy,
    sendingSessionId,
    watchedRunIdRef: activeRunIdRef,
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
