import type { ChatMessage } from "../types";

export interface UsageBarStats {
  turns: number;
  steps: number;
  lastRunSeconds: number | null;
  avgTtftSeconds: number | null;
  tokensPerSecond: number | null;
  cacheHitPercent: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Derives the composer stats-bar numbers from the active session's messages, or null if nothing has run yet. */
export function computeUsageBarStats(messages: ChatMessage[]): UsageBarStats | null {
  const assistantMessages = messages.filter((m) => m.role === "assistant" && m.status === "done");
  if (assistantMessages.length === 0) return null;

  const turns = messages.filter((m) => m.role === "user").length;
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  const steps = messages.slice(lastUserIndex + 1).filter((m) => m.role === "assistant").length;

  const last = assistantMessages[assistantMessages.length - 1]!;
  const timed = assistantMessages.filter((m) => m.timing);
  const avgTtftSeconds = timed.length > 0
    ? timed.reduce((sum, m) => sum + m.timing!.ttftMs, 0) / timed.length / 1000
    : null;

  const usage = last.tokenUsage;
  const totalMs = last.timing?.totalMs;
  const tokensPerSecond = usage?.completion_tokens && totalMs
    ? usage.completion_tokens / (totalMs / 1000)
    : null;
  const cacheHitPercent = usage?.cached_tokens && usage.prompt_tokens
    ? (usage.cached_tokens / usage.prompt_tokens) * 100
    : null;

  return {
    turns,
    steps,
    lastRunSeconds: totalMs ? totalMs / 1000 : null,
    avgTtftSeconds,
    tokensPerSecond,
    cacheHitPercent,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
  };
}
