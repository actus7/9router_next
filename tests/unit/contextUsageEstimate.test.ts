import { describe, expect, it } from "vitest";
import { estimateContextUsage } from "@/app/(dashboard)/dashboard/basic-chat/sections/contextUsageEstimate";

describe("estimateContextUsage", () => {
  it("sums system prompt, tools, and message tokens using a 4-chars-per-token heuristic", () => {
    const result = estimateContextUsage(
      [{ id: "u1", role: "user", content: "a".repeat(400) }],
      "b".repeat(200),
      "c".repeat(800),
      100_000,
    );
    expect(result).toMatchObject({ systemPromptTokens: 50, toolsTokens: 200, messagesTokens: 100, totalTokens: 350, contextWindowTokens: 100_000 });
    expect(result.percentUsed).toBeCloseTo(0.35);
  });

  it("defaults to the shared context-window constant when none is given", () => {
    const result = estimateContextUsage([], "", "");
    expect(result.contextWindowTokens).toBe(128_000);
  });
});
