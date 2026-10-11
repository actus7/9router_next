import { describe, expect, it, vi } from "vitest";

/**
 * Jev against TypeSafe's own API (api.typesafe.ai/v1/systemone) with a key from
 * console.typesafe.ai — the one the profile card saves on the account; here it
 * comes from LIVE_TYPESAFE_KEY instead of the database. Skipped unless asked
 * for: it spends the key's quota.
 * Only the two repos are stubbed; the HTTP call and the parsing are real —
 * this is what proves the direct dialect (`noul`, `jev-latest`) is the one the
 * API speaks, which the unit tests can only assume.
 *
 *   LIVE_TYPESAFE_KEY=<key> npx vitest run tests/unit/jevDirectLive.test.ts
 */
const live = !!process.env.LIVE_TYPESAFE_KEY;

vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({ decisionEngine: "jev" })) }));
vi.mock("@/lib/db/repos/decisionKeysRepo", () => ({ getTypesafeKey: vi.fn(async () => process.env.LIVE_TYPESAFE_KEY ?? null) }));
vi.mock("server-only", () => ({}));

describe.skipIf(!live)("Jev with a TypeSafe key", () => {
  it("passes the profile card's probe", async () => {
    const { probeJev } = await import("@/server/decisions/jev");
    const result = await probeJev(20_000);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });

  it("answers choice, yes/no and score questions", async () => {
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
    expect(answers).not.toBeNull();
    expect(answers!.tier).toMatchObject({ type: "choice", choice: "reasoning" });
    expect(answers!.remember.type).toBe("boolean");
    expect(answers!.difficulty.type).toBe("score");
  });
});
