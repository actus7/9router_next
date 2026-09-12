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
  SendScope,
} from "./useSendMessageTypes";

export type { UseSendMessageReturn } from "./useSendMessageTypes";

// Owns the streaming chat request lifecycle: building the request, reading
// the SSE stream into the active session's assistant message, retry/stop/
// feedback/export actions, and the transient error/streaming UI state.
/** One conversation's live stream. Empty is the shared identity, not a copy. */
interface StreamState {
  messageId: string;
  text: string;
  activities: AgentActivity[];
}

const EMPTY_STREAM: StreamState = { messageId: "", text: "", activities: [] };
const EMPTY_SENDING: ReadonlySet<string> = new Set();

/** What one conversation's in-flight send owns. A ref is just `{ current }`. */
interface SessionRun {
  abort: { current: AbortController | null };
  runId: { current: string | null };
  stopRequested: { current: boolean };
}

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
  // A run outlives the tab, so reading another conversation while one answers
  // is the normal case — and so is starting a second one. What used to be a
  // page-wide `isSending` is a set of the conversations that are working.
  const [sendingSessionIds, setSendingSessionIds] = useState<ReadonlySet<string>>(EMPTY_SENDING);
  // The conversation the most recent send went into. Only still here because
  // `chatError` is page-wide and has to say which conversation it belongs to.
  const [sendingSessionId, setSendingSessionId] = useState("");
  const [streamBySession, setStreamBySession] = useState<Record<string, StreamState>>({});
  /**
   * What each in-flight send owns, keyed by its conversation.
   *
   * These were three page-wide refs, and the first line of a send was
   * `abortRef.current?.abort()` — the client did not merely happen to run one
   * send at a time, it enforced it by killing whatever was already going.
   */
  const runsRef = useRef<Map<string, SessionRun>>(new Map());
  const sessionsRef = useRef(sessions);
  const sendMessageRef = useRef<
    ((options?: SendMessageOptions) => Promise<void>) | null
  >(null);
  // The last conversation a send claimed, so a throw before the request was
  // even built can clear the right one.
  const lastBegunRef = useRef("");

  const runFor = useCallback((sessionId: string): SessionRun => {
    const existing = runsRef.current.get(sessionId);
    if (existing) return existing;
    const created: SessionRun = { abort: { current: null }, runId: { current: null }, stopRequested: { current: false } };
    runsRef.current.set(sessionId, created);
    return created;
  }, []);

  // Stop and steer both mean "this run is over". Aborting locally only stops
  // watching — the work moved to the server — so both have to tell it. Aimed
  // at one conversation: page-wide, it stopped a run the reader never saw.
  const interrupt = useCallback((sessionId: string) => {
    const run = runsRef.current.get(sessionId);
    if (!run) return;
    const runId = run.runId.current;
    if (runId) void stopDurableRun(runId);
    // No id yet: the send is between its POST and the answer that names the
    // run. Remembered so it is stopped the moment it has a name.
    else run.stopRequested.current = true;
    run.abort.current?.abort();
  }, []);

  /** Something, somewhere, is answering. Not necessarily this conversation. */
  const isSending = sendingSessionIds.size > 0;

  /**
   * Whether *this* conversation is the one working.
   *
   * Every composer control used to read the page-wide flag, so "Stop" and the
   * queue button appeared on every conversation while any one of them worked,
   * and stop pressed in an idle conversation killed the run in another.
   */
  const isBusy = sendingSessionIds.has(activeSessionId);

  const stream = streamBySession[activeSessionId] ?? EMPTY_STREAM;
  const streamingMessageId = stream.messageId;
  const streamingText = stream.text;
  const liveActivities = stream.activities;

  /**
   * Hands a send everything it owns, once it knows which conversation it is in.
   *
   * The setters look page-wide to the send — same names, same signatures — and
   * write into that conversation's slot. That is what let the send itself stay
   * unchanged while stopping being the only one.
   */
  const beginSend = useCallback((sessionId: string): SendScope => {
    const run = runFor(sessionId);
    lastBegunRef.current = sessionId;
    const patch = (change: (previous: StreamState) => StreamState) =>
      setStreamBySession((current) => ({
        ...current,
        [sessionId]: change(current[sessionId] ?? EMPTY_STREAM),
      }));
    const apply = <T,>(value: React.SetStateAction<T>, previous: T): T =>
      typeof value === "function" ? (value as (p: T) => T)(previous) : value;
    return {
      abortRef: run.abort,
      activeRunIdRef: run.runId,
      stopRequestedRef: run.stopRequested,
      setStreamingMessageId: (value) => patch((p) => ({ ...p, messageId: apply(value, p.messageId) })),
      setStreamingText: (value) => patch((p) => ({ ...p, text: apply(value, p.text) })),
      setLiveActivities: (value) => patch((p) => ({ ...p, activities: apply(value, p.activities) })),
      setSending: (sending) => {
        if (sending) setSendingSessionId(sessionId);
        setSendingSessionIds((current) => {
          if (current.has(sessionId) === sending) return current;
          const next = new Set(current);
          if (sending) next.add(sessionId);
          else next.delete(sessionId);
          return next;
        });
      },
    };
  }, [runFor]);

  /** Whether a run already has a live send watching it — see the type's note. */
  const isRunWatched = useCallback((runId: string): boolean => {
    for (const run of runsRef.current.values()) if (run.runId.current === runId) return true;
    return false;
  }, []);

  const interruptActive = useCallback(() => interrupt(activeSessionId), [interrupt, activeSessionId]);

  const queue = useSendMessageQueue({
    isSending: isBusy,
    activeSessionId,
    activeModel,
    draft,
    attachments,
    setDraft,
    setAttachments,
    interrupt: interruptActive,
  });
  const { queuedReplayTimerRef } = queue;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Navigating away mid-stream must not leave the request running or keep
  // updating state on an unmounted component.
  useEffect(() => {
    const runs = runsRef;
    const queueTimer = queuedReplayTimerRef;
    return () => {
      // Every conversation that was streaming, not just the one on screen.
      // Leaving the page stops watching; the runs themselves finish server-side.
      for (const run of runs.current.values()) run.abort.current?.abort();
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
    if (isBusy || liveActivities.length === 0) return;
    const sessionId = activeSessionId;
    const timer = setTimeout(
      () =>
        setStreamBySession((current) => {
          const previous = current[sessionId];
          if (!previous || previous.activities.length === 0) return current;
          return { ...current, [sessionId]: { ...previous, activities: [] } };
        }),
      900,
    );
    return () => clearTimeout(timer);
  }, [activeSessionId, isBusy, liveActivities]);

  const canSend =
    !isBusy &&
    !!activeModel &&
    (draft.trim().length > 0 || attachments.length > 0);

  const resetStream = useCallback(() => {
    setStreamBySession((current) =>
      current[activeSessionId] ? { ...current, [activeSessionId]: EMPTY_STREAM } : current,
    );
    // The banner belongs to the run that failed. It used to be cleared only by
    // the *next* send, so a provider error survived "new chat" and sat above an
    // empty conversation as if the fresh one had already failed.
    setChatError("");
  }, [activeSessionId]);

  // The banner used to be wiped on every conversation change, which hid the
  // staleness without fixing it: a run that failed minutes after the reader
  // moved on still painted its error over whichever conversation was open, and
  // coming back to the one that actually failed erased the message. It is
  // scoped by owner at the render instead — see `BasicChatPageClient`.

  // Deliberately asymmetric with the unmount cleanup above: leaving the screen
  // aborts the watcher and lets the run finish on the server, while pressing
  // stop means stop, so it tells the server first.
  const handleStop = interruptActive;

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
      // A fresh send never inherits a stop aimed at the previous one. Reset
      // where the send will land, not page-wide: clearing every conversation's
      // flag here would swallow a stop aimed at one still answering.
      lastBegunRef.current = "";
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
          setChatError,
          beginSend,
          dequeueNext: queue.dequeueNext,
          replayQueuedMessage,
        });
      } catch (error) {
        // `executeSendMessage` guards the request, but it turns `isSending` on
        // long before that guard — everything that builds the request runs
        // outside it. A throw there left the composer disabled and the card
        // frozen until the page was reloaded, with nothing said about why.
        setChatError(error instanceof Error ? error.message : "The send failed.");
        // Only the conversation this send had claimed. A page-wide clear here
        // would mark another conversation idle while it was still answering.
        const claimed = lastBegunRef.current;
        if (claimed) {
          setSendingSessionIds((current) => {
            if (!current.has(claimed)) return current;
            const next = new Set(current);
            next.delete(claimed);
            return next;
          });
        }
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
      beginSend,
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
    isRunWatched,
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
