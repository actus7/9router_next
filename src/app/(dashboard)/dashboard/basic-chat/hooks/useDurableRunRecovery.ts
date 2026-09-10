"use client";

import { useEffect, useRef } from "react";

import { watchDurableRun } from "./executeDurableChat";
import type { ChatMessage, ChatSession } from "../types";

/** The run row as `/api/harness/runs` serializes it. */
interface RunRow {
  id: string;
  sessionId: string;
  messageId: string;
  status: "running" | "completed" | "failed" | "stopped";
  partialText: string;
  reasoning: string | null;
  usage: Record<string, unknown> | null;
  error: string | null;
}

interface UseDurableRunRecoveryArgs {
  activeSessionId: string;
  /** True once local sessions have loaded, so a run is not applied to an empty list. */
  isReady: boolean;
  updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
}

/**
 * Whether the run still has something to say that the message does not.
 *
 * Not simply "is it unfinished": leaving mid-answer aborts the local fetch,
 * and the abort handler settles the message to `done` with whatever text had
 * arrived. That message looks finished and is not. So a shorter local text
 * than the run's is also a message waiting to be completed — the run is the
 * authority on the full answer, the interrupted tab is not.
 */
function shouldApply(message: ChatMessage, text: string): boolean {
  if (message.status !== "done" && message.status !== "error") return true;
  return text.length > String(message.content ?? "").length;
}

function applySettled(message: ChatMessage, run: RunRow): ChatMessage {
  if (run.status === "failed") {
    return {
      ...message,
      content: message.content || `Error: ${run.error || "The run failed."}`,
      status: "error",
    };
  }
  return {
    ...message,
    content: run.partialText || message.content,
    status: "done",
    ...(run.reasoning ? { reasoning: run.reasoning } : {}),
    ...(run.usage ? { tokenUsage: run.usage as ChatMessage["tokenUsage"] } : {}),
  };
}

/**
 * Reconnects the conversation to runs that kept going without it.
 *
 * Two cases, and the second is the one that matters most in practice:
 *
 *   - the run finished while the tab was closed, so its text is folded in and
 *     the row deleted;
 *   - the run is *still going*, so this re-attaches to its stream. The send
 *     path that started it died with the previous mount — if nobody picks the
 *     run up here, coming back mid-answer shows a truncated message that never
 *     moves again, even though the server is still writing it.
 *
 * The worker never writes `harnessConversations` itself: the client replaces
 * that table wholesale on every sync, so a background write would be raced
 * away. This hook is the other half of that decision.
 */
export function useDurableRunRecovery({ activeSessionId, isReady, updateSession }: UseDurableRunRecoveryArgs): void {
  const handledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isReady || !activeSessionId) return;
    const controller = new AbortController();

    const writeMessage = (messageId: string, text: string, update: (message: ChatMessage) => ChatMessage) => {
      updateSession(activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === messageId && shouldApply(message, text) ? update(message) : message,
        ),
        updatedAt: new Date().toISOString(),
      }));
    };

    const drop = async (ids: readonly string[]) => {
      if (!ids.length) return;
      await fetch("/api/harness/runs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        signal: controller.signal,
      }).catch(() => undefined);
    };

    void (async () => {
      const response = await fetch(
        `/api/harness/runs?sessionId=${encodeURIComponent(activeSessionId)}`,
        { signal: controller.signal },
      ).catch(() => null);
      if (!response?.ok || controller.signal.aborted) return;

      const { runs } = (await response.json().catch(() => ({ runs: [] }))) as { runs: RunRow[] };
      const fresh = runs.filter((run) => !handledRef.current.has(run.id));
      if (!fresh.length) return;
      for (const run of fresh) handledRef.current.add(run.id);

      const settled = fresh.filter((run) => run.status !== "running");
      for (const run of settled) {
        writeMessage(run.messageId, run.partialText, (message) => applySettled(message, run));
      }
      // The delete can be aborted by leaving the screen, and the `.catch` on it
      // is silent. Forgetting these ids lets the next pass collect the rows
      // instead of leaving them to expire with a "finished" badge on a
      // conversation the user already read.
      if (settled.length > 0) {
        await drop(settled.map((run) => run.id));
        if (controller.signal.aborted) {
          for (const run of settled) handledRef.current.delete(run.id);
          return;
        }
      }

      // Re-attach to whatever is still in flight. The stream replays the text
      // accumulated so far before following along, so the message catches up
      // in one frame rather than resuming from wherever the tab left off.
      await Promise.all(
        fresh
          .filter((run) => run.status === "running")
          .map(async (run) => {
            try {
              const result = await watchDurableRun(run.id, {
                signal: controller.signal,
                onStreamText: (text: string) => {
                  writeMessage(run.messageId, text, (message) => ({
                    ...message,
                    content: text,
                    status: "streaming",
                  }));
                },
              });
              writeMessage(run.messageId, result.text, (message) => ({
                ...message,
                content: result.text || message.content,
                status: "done",
                ...(result.reasoning ? { reasoning: result.reasoning } : {}),
                ...(result.usage ? { tokenUsage: result.usage } : {}),
              }));
              await drop([run.id]);
            } catch (error) {
              // Nothing that failed here is remembered as handled. Leaving the
              // screen aborts the watcher, and refusing to attach is not the
              // run's fault either: `MAX_WATCHERS_PER_ACCOUNT` is 8 while
              // `MAX_CONCURRENT_RUNS` is 12, and two tabs share the count, so a
              // 429 was routine — it marked a live run as failed and that tab
              // never read it again, not even after switching sessions.
              handledRef.current.delete(run.id);
              if ((error as Error)?.name === "AbortError") return;
              const message = (error as Error)?.message || "The run failed.";
              // A refusal to watch says nothing about the run, so it must not
              // be written onto the message as the run's own failure.
              if (/too many/i.test(message)) return;
              writeMessage(run.messageId, "", (item) => ({
                ...item,
                content: item.content || `Error: ${message}`,
                status: "error",
              }));
            }
          }),
      );
    })();

    return () => {
      controller.abort();
    };
  }, [activeSessionId, isReady, updateSession]);
}
