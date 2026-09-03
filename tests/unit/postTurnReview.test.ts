import { describe, expect, it, vi } from "vitest";

const insertPending = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/lib/db/repos/harnessLearningConfigRepo", () => ({
  getHarnessLearningConfig: vi.fn(async () => ({
    memoryWriteApproval: true,
    memoryAgentEnabled: true,
    memoryUserEnabled: true,
    learningReviewEnabled: true,
    learningReviewModel: "",
    learningDeferWhenBusy: true,
    memoryNotifications: true,
  })),
}));

vi.mock("@/lib/db/repos/harnessPendingWritesRepo", () => ({
  insertHarnessPendingWrite: insertPending,
}));

import { runPostTurnReview } from "@/server/harness/learning/postTurnReview";

describe("runPostTurnReview", () => {
  it("queues memory when user asks to remember", async () => {
    const result = await runPostTurnReview({
      sessionId: "s1",
      runId: "r1",
      userText: "Please remember that I prefer Portuguese",
      assistantText: "Sure, I'll remember that.",
    });
    expect(result.queued).toBe(1);
    expect(insertPending).toHaveBeenCalledOnce();
  });
});
