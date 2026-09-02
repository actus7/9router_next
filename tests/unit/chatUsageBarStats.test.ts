import { describe, expect, it } from "vitest";
import { computeUsageBarStats } from "@/app/(dashboard)/dashboard/basic-chat/sections/chatUsageBarStats";
import type { ChatMessage } from "@/app/(dashboard)/dashboard/basic-chat/types";

describe("computeUsageBarStats", () => {
  it("returns null when no assistant message has completed", () => {
    expect(computeUsageBarStats([{ id: "u1", role: "user", content: "hi" }])).toBeNull();
  });

  it("computes turns, steps, and per-token rate from the last completed assistant message", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello", status: "done", timing: { ttftMs: 500, totalMs: 2000 }, tokenUsage: { prompt_tokens: 100, completion_tokens: 50, cached_tokens: 40 } },
    ];
    const stats = computeUsageBarStats(messages);
    expect(stats).toMatchObject({ turns: 1, steps: 1, lastRunSeconds: 2, avgTtftSeconds: 0.5, tokensPerSecond: 25, cacheHitPercent: 40, inputTokens: 100, outputTokens: 50 });
  });

  it("counts multiple assistant steps (tool-call round-trips) after the last user message", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "", status: "done", toolCalls: [{ id: "c1", name: "web_search", arguments: "{}" }] },
      { id: "t1", role: "tool", toolCallId: "c1", content: "{}" },
      { id: "a2", role: "assistant", content: "done", status: "done", timing: { ttftMs: 300, totalMs: 900 } },
    ];
    expect(computeUsageBarStats(messages)?.steps).toBe(2);
  });

  it("omits cache hit percent when no cached tokens were reported", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello", status: "done", tokenUsage: { prompt_tokens: 100, completion_tokens: 50 } },
    ];
    expect(computeUsageBarStats(messages)?.cacheHitPercent).toBeNull();
  });
});
