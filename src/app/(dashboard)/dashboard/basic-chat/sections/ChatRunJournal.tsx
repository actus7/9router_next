"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "../chatFormatUtils";
import type { UseHarnessEventsReturn } from "../hooks/useHarnessEvents";
import {
  classifyEventKind,
  eventColorClass,
  eventLabel,
  eventTimelineOffsets,
  formatDuration,
  formatTokenUsage,
  groupHarnessEvents,
  type RunJournalGroup,
} from "../runJournalHelpers";
import type { HarnessEvent } from "../types";

interface ChatRunJournalProps {
  harnessHook: UseHarnessEventsReturn;
}

/** Readable one-line preview for the most common event types; other types show no preview (JSON is still available on expand). */
function readEventText(event: HarnessEvent): string {
  if (event.type === "user/message" || event.type === "assistant/message" || event.type === "assistant/reasoning") {
    return typeof event.data?.content === "string" ? event.data.content : "";
  }
  if (event.type === "tool/call") {
    const name = typeof event.data?.name === "string" ? event.data.name : "tool";
    const args = typeof event.data?.arguments === "string" ? event.data.arguments : "";
    return `${name}(${args})`;
  }
  if (event.type === "tool/result") {
    return typeof event.data?.content === "string" ? event.data.content.slice(0, 500) : "";
  }
  return "";
}

function EventRow({ event, isOpen, onToggle }: { event: HarnessEvent; isOpen: boolean; onToggle: () => void }) {
  const preview = readEventText(event);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-xs hover:text-foreground"
        aria-expanded={isOpen}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${eventColorClass(event.type)}`} aria-hidden />
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9px] uppercase tracking-wide">
          {classifyEventKind(event)}
        </Badge>
        <span className="font-mono tabular-nums text-muted-foreground">{event.seq}</span>
        <span className="min-w-0 truncate font-medium text-foreground">{eventLabel(event.type)}</span>
        <time className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(event.createdAt)}</time>
      </button>
      {preview && !isOpen && (
        <p className="mb-1 truncate pl-3.5 text-[11px] italic text-muted-foreground">{preview}</p>
      )}
      {isOpen && (
        <pre className="mb-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
          {JSON.stringify(event.data, null, 2)}
        </pre>
      )}
    </li>
  );
}

function RunTimeline({ group }: { group: RunJournalGroup }) {
  if (!group.durationMs) return null;
  const offsets = eventTimelineOffsets(group);
  return (
    <div className="relative mb-1 h-1 w-full overflow-hidden rounded-full bg-muted/60" aria-hidden>
      {group.events.map((event, index) => (
        <span
          key={`${event.sessionId}:${event.seq}`}
          className={`absolute top-0 h-full w-1 rounded-full ${eventColorClass(event.type)}`}
          style={{ left: `${offsets[index]}%` }}
        />
      ))}
    </div>
  );
}

export default function ChatRunJournal({ harnessHook }: ChatRunJournalProps) {
  const { showRunJournal, harnessEvents } = harnessHook;
  const [openKey, setOpenKey] = useState("");

  if (!showRunJournal) return null;

  const groups = groupHarnessEvents(harnessEvents);

  return (
    <section className="shrink-0 border-b border-border bg-card/50 px-4 py-3" aria-label="Run journal">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Run journal</h2>
            <p className="text-xs text-muted-foreground">Step-by-step activity for this conversation — click a row for details.</p>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{harnessEvents.length} events</span>
        </div>
        {groups.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">The next message will open a recorded run.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto custom-scrollbar">
            {groups.map((group) => (
              <div key={group.runId} className="mb-2 border-l border-border pl-3 last:mb-0">
                {(group.durationMs != null || group.usage) && (
                  <div className="mb-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {group.durationMs != null && <span>{formatDuration(group.durationMs)}</span>}
                    {group.usage && <span>{formatTokenUsage(group.usage)}</span>}
                  </div>
                )}
                <RunTimeline group={group} />
                <ol className="flex flex-col">
                  {group.events.map((event) => {
                    const key = `${event.sessionId}:${event.seq}`;
                    return (
                      <EventRow
                        key={key}
                        event={event}
                        isOpen={openKey === key}
                        onToggle={() => setOpenKey((current) => (current === key ? "" : key))}
                      />
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
