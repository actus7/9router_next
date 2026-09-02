"use client";

import { computeUsageBarStats } from "./chatUsageBarStats";
import type { ChatMessage } from "../types";

interface ChatUsageBarProps {
  messages: ChatMessage[];
}

/** Compact stats line under the composer: turns/steps, last-run latency, throughput, cache hit, token counts. */
export default function ChatUsageBar({ messages }: ChatUsageBarProps) {
  const stats = computeUsageBarStats(messages);
  if (!stats) return null;

  const parts: string[] = [`${stats.turns} turn${stats.turns === 1 ? "" : "s"} · ${stats.steps} step${stats.steps === 1 ? "" : "s"}`];
  if (stats.lastRunSeconds !== null) parts.push(`LLM ${stats.lastRunSeconds.toFixed(1)}s`);
  if (stats.avgTtftSeconds !== null && stats.tokensPerSecond !== null) {
    parts.push(`TTFT avg ${stats.avgTtftSeconds.toFixed(1)}s · ${stats.tokensPerSecond.toFixed(0)} tok/s`);
  }
  if (stats.cacheHitPercent !== null) parts.push(`Cache hit ${stats.cacheHitPercent.toFixed(0)}%`);
  if (stats.inputTokens !== null && stats.outputTokens !== null) {
    parts.push(`Input ${stats.inputTokens} tok · Output ${stats.outputTokens} tok`);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-2">
      <p className="truncate text-center text-[11px] text-muted-foreground">{parts.join("  |  ")}</p>
    </div>
  );
}
