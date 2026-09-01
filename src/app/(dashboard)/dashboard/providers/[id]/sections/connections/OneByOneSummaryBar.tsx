"use client";

import type { Connection, OneByOneSummary } from "../../types";

interface OneByOneSummaryBarProps {
  summary: OneByOneSummary;
  running: boolean;
  currentConnectionId: string | null;
  connections: Connection[];
}

export default function OneByOneSummaryBar({
  summary,
  running,
  currentConnectionId,
  connections,
}: OneByOneSummaryBarProps) {
  return (
    <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
      {summary.total > 0 && (
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${(summary.completed / summary.total) * 100}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span>Total: {summary.total}</span>
        <span>Completed: {summary.completed}</span>
        <span>Passed: {summary.passed}</span>
        <span>Failed: {summary.failed}</span>
        {summary.stopped && (
          <span className="text-warning-foreground dark:text-warning-foreground">Stopped</span>
        )}
        {running && currentConnectionId && (
          <span>Running: {connections.find((conn) => conn.id === currentConnectionId)?.name || currentConnectionId}</span>
        )}
      </div>
    </div>
  );
}
