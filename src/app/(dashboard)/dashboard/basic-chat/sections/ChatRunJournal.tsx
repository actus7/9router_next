"use client";

import { formatRelativeTime } from "../chatFormatUtils";
import type { UseHarnessEventsReturn } from "../hooks/useHarnessEvents";

interface ChatRunJournalProps {
  harnessHook: UseHarnessEventsReturn;
}

export default function ChatRunJournal({ harnessHook }: ChatRunJournalProps) {
  const { showRunJournal, harnessEvents } = harnessHook;

  if (!showRunJournal) return null;

  return (
    <section className="shrink-0 border-b border-border bg-card/50 px-4 py-3" aria-label="Run journal">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Run journal</h2>
            <p className="text-xs text-muted-foreground">Ordered, durable activity for this conversation.</p>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{harnessEvents.length} events</span>
        </div>
        {harnessEvents.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">The next message will open a recorded run.</p>
        ) : (
          <ol className="max-h-36 space-y-1 overflow-y-auto border-l border-border pl-3 custom-scrollbar">
            {harnessEvents.slice(-12).map((event) => (
              <li key={`${event.sessionId}:${event.seq}`} className="flex min-w-0 items-center gap-2 py-0.5 text-xs">
                <span className="font-mono tabular-nums text-muted-foreground">{event.seq}</span>
                <span className="min-w-0 truncate font-medium text-foreground">{event.type}</span>
                <time className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(event.createdAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
