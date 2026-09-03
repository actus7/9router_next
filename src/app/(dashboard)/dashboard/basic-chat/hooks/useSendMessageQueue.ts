"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "../types";
import type { QueuedMessage } from "./useSendMessageTypes";

export interface UseSendMessageQueueArgs {
  isSending: boolean;
  draft: string;
  attachments: ChatAttachment[];
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  abortRef: React.MutableRefObject<AbortController | null>;
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
  clearQueue: () => void;
  dequeueNext: () => QueuedMessage | undefined;
}

export function useSendMessageQueue({
  isSending,
  draft,
  attachments,
  setDraft,
  setAttachments,
  abortRef,
}: UseSendMessageQueueArgs): UseSendMessageQueueReturn {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);
  const queuedReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);

  const canQueue =
    isSending && (draft.trim().length > 0 || attachments.length > 0);

  const clearQueue = useCallback(() => {
    queuedMessagesRef.current = [];
    setQueuedMessages([]);
  }, []);

  const queueMessage = useCallback(() => {
    if (!canQueue) return;
    const text = draft.trim();
    const item: QueuedMessage = { id: crypto.randomUUID(), text, attachments };
    const next = [...queuedMessagesRef.current, item];
    queuedMessagesRef.current = next;
    setQueuedMessages(next);
    setDraft("");
    setAttachments([]);
  }, [attachments, canQueue, draft, setAttachments, setDraft]);

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

  const steerMessage = useCallback(() => {
    if (!canQueue) return;
    queueMessage();
    abortRef.current?.abort();
  }, [abortRef, canQueue, queueMessage]);

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
    clearQueue,
    dequeueNext,
  };
}
