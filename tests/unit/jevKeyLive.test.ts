import { describe, expect, it, vi } from "vitest";

/**
 * Jev against the real Vercel AI Gateway, with the key from the environment
 * instead of an account's `vercel-ai-gateway` connection — so it runs without
 * the database. `jevLive.test.ts` is the same check through the real account.
 * Only the two repos are stubbed; the HTTP call and the parsing are real.
 *
 *   LIVE_JEV_KEY=1 npx vitest run tests/unit/jevKeyLive.test.ts   (reads JEV_KEY from .env)
 */
const live = process.env.LIVE_JEV_KEY === "1" && !!process.env.JEV_KEY;

vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => [{ apiKey: process.env.JEV_KEY, isActive: true }]),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ decisionEngine: "jev", jevSmartRouting: true, jevMemoryReview: true })),
}));
vi.mock("server-only", () => ({}));

describe.skipIf(!live)("Jev with the gateway key", () => {
  it("answers choice, boolean and score questions", async () => {
    const { evaluateJev } = await import("@/server/decisions/jev");
    const answers = await evaluateJev(
      "Prove that the square root of 2 is irrational.",
      {
        tier: { type: "choice", instructions: "How capable a model does this need?", criteria: { simple: "Trivial lookup or greeting", reasoning: "Formal proof or math" } },
        remember: { type: "boolean", instructions: "Does the user state a durable personal preference?" },
        difficulty: { type: "score", instructions: "How hard is it?", criteria: ["Easy", "Medium", "Hard"] },
      },
      20_000,
    );
    expect(answers, "Jev returned null — key, timeout or shape").not.toBeNull();
    expect(answers!.tier).toMatchObject({ type: "choice", choice: "reasoning" });
    expect(answers!.remember.type).toBe("boolean");
    expect(answers!.difficulty.type).toBe("score");
  }, 60_000);

  it("classifies a coding request for smart routing", async () => {
    const { buildJevClassifierCallback } = await import("@/server/llm-gateway/application/routingClassifier");
    const result = await buildJevClassifierCallback()("Write a Python function that parses ISO dates", "general", 20_000);
    expect(result).toMatchObject({ need: "coding", model: "typesafe-ai/jev" });
    expect(result!.confidence).toBeGreaterThan(0);
  }, 60_000);

  it("recognises a durable preference for memory review", async () => {
    const { evaluateJev } = await import("@/server/decisions/jev");
    const answers = await evaluateJev(
      "Lembre-se: eu sempre prefiro respostas em português e código em TypeScript.",
      { remember: { type: "boolean", instructions: "Does the user state a durable personal preference worth remembering?" } },
      20_000,
    );
    expect(answers?.remember.type).toBe("boolean");
    expect((answers!.remember as { probability: number }).probability).toBeGreaterThan(0.5);
  }, 60_000);
});
