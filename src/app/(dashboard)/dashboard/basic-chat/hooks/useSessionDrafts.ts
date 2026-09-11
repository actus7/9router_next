"use client";

import { useCallback, useMemo, useState } from "react";

import type { ChatAttachment } from "../types";

interface SessionDraft {
  text: string;
  attachments: ChatAttachment[];
}

const EMPTY: SessionDraft = { text: "", attachments: [] };

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface UseSessionDraftsReturn {
  draft: string;
  setDraft: Setter<string>;
  attachments: ChatAttachment[];
  setAttachments: Setter<ChatAttachment[]>;
  /** Every conversation's unsent text, for persistence. */
  drafts: Record<string, SessionDraft>;
  /** Restores what was saved, and folds in a pre-split single draft. */
  hydrate: (saved: Record<string, SessionDraft>, legacy: string, sessionId: string) => void;
}

/**
 * What the user has typed but not sent, kept per conversation.
 *
 * It was one page-level value, so half a question typed in one conversation
 * followed the reader into the next one — sitting in the composer of a chat it
 * was never meant for, one Enter away from being sent there. Attachments rode
 * along the same way.
 *
 * Deliberately not stored in `ChatSession`: a draft is local to this browser
 * and must not sync to other devices or bump the conversation's `updatedAt`,
 * which is what decides sync precedence.
 */
export function useSessionDrafts(activeSessionId: string): UseSessionDraftsReturn {
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});

  const current = drafts[activeSessionId] ?? EMPTY;

  const patch = useCallback(
    (change: (previous: SessionDraft) => SessionDraft) => {
      setDrafts((previous) => {
        const before = previous[activeSessionId] ?? EMPTY;
        const after = change(before);
        if (after.text === before.text && after.attachments === before.attachments) return previous;
        // An empty draft is not worth a row: it would keep every conversation
        // the user ever opened alive in storage.
        if (!after.text && after.attachments.length === 0) {
          if (!(activeSessionId in previous)) return previous;
          const { [activeSessionId]: _dropped, ...rest } = previous;
          return rest;
        }
        return { ...previous, [activeSessionId]: after };
      });
    },
    [activeSessionId],
  );

  const setDraft = useCallback<Setter<string>>(
    (value) => patch((before) => ({
      ...before,
      text: typeof value === "function" ? value(before.text) : value,
    })),
    [patch],
  );

  const setAttachments = useCallback<Setter<ChatAttachment[]>>(
    (value) => patch((before) => ({
      ...before,
      attachments: typeof value === "function" ? value(before.attachments) : value,
    })),
    [patch],
  );

  const hydrate = useCallback(
    (saved: Record<string, SessionDraft>, legacy: string, sessionId: string) => {
      // `legacy` is the single page-wide draft this replaced. It belongs to
      // whichever conversation was open when the tab closed, which is the one
      // being restored — dropping it would lose real typing on the upgrade.
      const seed = legacy && sessionId && !saved[sessionId]
        ? { ...saved, [sessionId]: { text: legacy, attachments: [] } }
        : saved;
      setDrafts(seed);
    },
    [],
  );

  return useMemo(
    () => ({
      draft: current.text,
      setDraft,
      attachments: current.attachments,
      setAttachments,
      drafts,
      hydrate,
    }),
    [current, drafts, hydrate, setAttachments, setDraft],
  );
}
