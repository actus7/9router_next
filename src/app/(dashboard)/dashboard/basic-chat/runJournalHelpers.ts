import type { HarnessEvent, TokenUsage } from "./types";

export type EventKind = "system" | "context" | "user" | "assistant" | "tool";

/** Buckets a raw harness event type string into the Trajectory tab's taxonomy. */
export function classifyEventKind(event: HarnessEvent): EventKind {
  if (event.type.startsWith("user/")) return "user";
  if (event.type.startsWith("assistant/")) return "assistant";
  if (event.type.startsWith("tool/")) return "tool";
  if (event.type.startsWith("skill/")) return "context";
  if (event.type.startsWith("run/")) return "system";
  return "context";
}

export interface RunJournalGroup {
  runId: string;
  events: HarnessEvent[];
  durationMs: number | null;
  usage: TokenUsage | null;
}

/** Group events by their shared `data.runId` (falling back to one event per group), and compute each group's wall-clock span and reported token usage. */
export function groupHarnessEvents(events: HarnessEvent[]): RunJournalGroup[] {
  const order: string[] = [];
  const byRun = new Map<string, HarnessEvent[]>();

  for (const event of events) {
    const runId = typeof event.data?.runId === "string" ? event.data.runId : `event:${event.seq}`;
    const bucket = byRun.get(runId);
    if (bucket) {
      bucket.push(event);
    } else {
      byRun.set(runId, [event]);
      order.push(runId);
    }
  }

  return order.map((runId) => {
    const groupEvents = byRun.get(runId) as HarnessEvent[];
    const durationMs = groupEvents.length > 1
      ? new Date(groupEvents[groupEvents.length - 1].createdAt).getTime() - new Date(groupEvents[0].createdAt).getTime()
      : null;
    const usageEvent = groupEvents.find((event) => event.data?.usage && typeof event.data.usage === "object");
    return {
      runId,
      events: groupEvents,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      usage: (usageEvent?.data.usage as TokenUsage | undefined) || null,
    };
  });
}

/** Each event's position within its group's timeline, as a 0-100 percentage, for a lightweight proportional bar (no charting lib). */
export function eventTimelineOffsets(group: RunJournalGroup): number[] {
  if (!group.durationMs) return group.events.map(() => 0);
  const startedAt = new Date(group.events[0].createdAt).getTime();
  return group.events.map((event) => {
    const offset = ((new Date(event.createdAt).getTime() - startedAt) / group.durationMs!) * 100;
    return Math.min(100, Math.max(0, offset));
  });
}

const EVENT_LABELS: Record<string, string> = {
  "user/message": "User",
  "run/start": "Run start",
  "run/complete": "Run complete",
  "run/end": "Run end",
  "tool/call": "Tool call",
  "tool/result": "Tool result",
  "skill/load": "Skill loaded",
  "skill/created": "Skill created",
  "skill/updated": "Skill updated",
  "assistant/message": "Assistant",
  "assistant/reasoning": "Reasoning",
};

const EVENT_COLORS: Record<string, string> = {
  "user/message": "bg-sky-500",
  "run/start": "bg-muted-foreground",
  "run/complete": "bg-emerald-500",
  "run/end": "bg-emerald-500",
  "tool/call": "bg-amber-500",
  "tool/result": "bg-amber-600",
  "skill/load": "bg-teal-500",
  "skill/created": "bg-teal-600",
  "skill/updated": "bg-teal-400",
  "assistant/message": "bg-violet-500",
  "assistant/reasoning": "bg-fuchsia-500",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] || type;
}

export function eventColorClass(type: string): string {
  return EVENT_COLORS[type] || "bg-muted-foreground";
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokenUsage(usage: TokenUsage | null): string {
  if (!usage) return "";
  const inTok = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;
  if (!inTok && !outTok) return "";
  return `${inTok} in · ${outTok} out`;
}
