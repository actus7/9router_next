import { beforeEach, describe, expect, it, vi } from "vitest";

const insertPending = vi.hoisted(() => vi.fn(async () => ({})));
const jev = vi.hoisted(() => ({ isJevFeatureEnabled: vi.fn(async () => false), evaluateJev: vi.fn() }));

vi.mock("@/server/decisions/jev", () => jev);

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
  beforeEach(() => {
    insertPending.mockClear();
    jev.isJevFeatureEnabled.mockResolvedValue(false);
    jev.evaluateJev.mockReset();
  });

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

  it("with Jev on, queues a durable fact no keyword matches", async () => {
    jev.isJevFeatureEnabled.mockResolvedValue(true);
    jev.evaluateJev.mockResolvedValue({ remember: { type: "boolean", probability: 0.93 } });

    const result = await runPostTurnReview({ sessionId: "s1", runId: "r1", userText: "I'm vegetarian", assistantText: "" });

    expect(result.queued).toBe(1);
  });

  it("with Jev on, skips a keyword match Jev says is one-off", async () => {
    jev.isJevFeatureEnabled.mockResolvedValue(true);
    jev.evaluateJev.mockResolvedValue({ remember: { type: "boolean", probability: 0.05 } });

    const result = await runPostTurnReview({ sessionId: "s1", runId: "r1", userText: "remember to close the tag in this snippet", assistantText: "" });

    expect(result.queued).toBe(0);
  });

  it("falls back to the keyword patterns when Jev is unreachable", async () => {
    jev.isJevFeatureEnabled.mockResolvedValue(true);
    jev.evaluateJev.mockResolvedValue(null);

    expect((await runPostTurnReview({ sessionId: "s1", runId: "r1", userText: "please remember I use pnpm", assistantText: "" })).queued).toBe(1);
    expect((await runPostTurnReview({ sessionId: "s1", runId: "r1", userText: "I'm vegetarian", assistantText: "" })).queued).toBe(0);
  });
});
