"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatAttachment, NormalizedModel } from "../types";
import type { QueuedMessage } from "./useSendMessageTypes";
import { createId } from "../chatFormatUtils";

export interface UseSendMessageQueueArgs {
  isSending: boolean;
  /** Stamped onto each queued message so replay lands where it was typed. */
  activeSessionId: string;
  /** Stamped for the same reason: replay must not inherit the reader's model. */
  activeModel: NormalizedModel | null;
  draft: string;
  attachments: ChatAttachment[];
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  /** Ends the run in flight — on the server too, not just this watcher. */
  interrupt: () => void;
}

export interface UseSendMessageQueueReturn {
  queuedMessages: QueuedMessage[];
  queuedMessagesRef: React.MutableRefObject<QueuedMessage[]>;
  queuedReplayTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  canQueue: boolean;
  queueMessage: () => void;
  steerMessage: () => void;
  cancelQueuedMessage: (id: string) => void;
  moveQueuedMessage: (id: string, direction: "up" | "down") => void;
  /** Drops items whose conversation no longer exists. */
  pruneQueue: (liveSessionIds: readonly string[]) => void;
  dequeueNext: () => QueuedMessage | undefined;
}

export function useSendMessageQueue({
  isSending,
  activeSessionId,
  activeModel,
  draft,
  attachments,
  setDraft,
  setAttachments,
  interrupt,
}: UseSendMessageQueueArgs): UseSendMessageQueueReturn {
  // The ref is what the send loop reads mid-flight, when a re-render has not
  // happened yet; every mutation below writes both, so nothing syncs them after.
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);
  const queuedReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canQueue =
    isSending && (draft.trim().length > 0 || attachments.length > 0);

  /**
   * Forgets follow-ups whose conversation was deleted.
   *
   * The replay refuses to resurrect one, so without this they sat in the bar
   * forever — invisible, since the bar only shows the open conversation's, and
   * undeliverable.
   */
  const pruneQueue = useCallback((liveSessionIds: readonly string[]) => {
    // An empty list is hydration, not "every conversation was deleted".
    if (liveSessionIds.length === 0) return;
    const live = new Set(liveSessionIds);
    const next = queuedMessagesRef.current.filter((item) => live.has(item.sessionId));
    if (next.length === queuedMessagesRef.current.length) return;
    queuedMessagesRef.current = next;
    setQueuedMessages(next);
  }, []);

  const queueMessage = useCallback(() => {
    if (!canQueue) return;
    const text = draft.trim();
    const item: QueuedMessage = { id: createId(), text, attachments, sessionId: activeSessionId, model: activeModel };
    const next = [...queuedMessagesRef.current, item];
    queuedMessagesRef.current = next;
    setQueuedMessages(next);
    setDraft("");
    setAttachments([]);
  }, [activeModel, activeSessionId, attachments, canQueue, draft, setAttachments, setDraft]);

  const cancelQueuedMessage = useCallback((id: string) => {
    const next = queuedMessagesRef.current.filter((item) => item.id !== id);
    queuedMessagesRef.current = next;
    setQueuedMessages(next);
  }, []);

  const moveQueuedMessage = useCallback(
    (id: string, direction: "up" | "down") => {
      const current = queuedMessagesRef.current;
      const index = current.findIndex((item) => item.id === id);
      if (index === -1) return;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) return;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
      queuedMessagesRef.current = next;
      setQueuedMessages(next);
    },
    [],
  );

  // Steering interrupts the run and sends the new message instead, so it has to
  // reach the server like stop does. Aborting locally only stopped watching,
  // leaving the run the user steered away from burning quota — and its answer
  // was folded back into the conversation later by run recovery.
  const steerMessage = useCallback(() => {
    if (!canQueue) return;
    queueMessage();
    interrupt();
  }, [canQueue, interrupt, queueMessage]);

  const dequeueNext = useCallback((): QueuedMessage | undefined => {
    const [next, ...rest] = queuedMessagesRef.current;
    if (!next) return undefined;
    queuedMessagesRef.current = rest;
    setQueuedMessages(rest);
    return next;
  }, []);

  return {
    queuedMessages,
    queuedMessagesRef,
    queuedReplayTimerRef,
    canQueue,
    queueMessage,
    steerMessage,
    cancelQueuedMessage,
    moveQueuedMessage,
    pruneQueue,
    dequeueNext,
  };
}
