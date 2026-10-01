import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The unified error classifier: one judge verdict (`ErrorJudgement`) replaces
// the ~21 regex/status rules when Jev answers, and every rule stays byte-for-
// byte identical when it does not. The judge is installed through the host
// seam, exactly as the application bootstrap does — no module mocking needed.

/**
 * Stands in for the `modelAvailability` table (same fake idea as
 * accountFallbackPolicy.test.ts), so cooldowns can be asserted through the
 * real `isNoAuthOnCooldown` reader.
 */
const availabilityStore = vi.hoisted(() => new Map<string, { until: string | null }>());
const setModelAvailability = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async (connectionIds?: string[]) => {
    const now = Date.now();
    return (connectionIds ?? [])
      .map((id) => ({ id, row: availabilityStore.get(id) }))
      .filter((entry) => entry.row && (!entry.row.until || Date.parse(entry.row.until) > now))
      .map((entry) => ({ connectionId: entry.id, modelId: "__all", until: entry.row!.until }));
  }),
  setModelAvailability: setModelAvailability.mockImplementation(async (input: { connectionId: string; until: string | null }) => {
    availabilityStore.set(input.connectionId, { until: input.until });
  }),
  clearModelAvailability: vi.fn(async () => {}),
}));

const getProviderConnections = vi.hoisted(() => vi.fn());
const updateProviderConnection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections, updateProviderConnection }));

import {
  checkFallbackError,
  fallbackDecisionFromJudgement,
  isToolUnsupportedError,
  judgeUpstreamError,
} from "@/server/llm-gateway/engine/services/accountFallback";
import { setErrorJudge, type ErrorJudgement, type UpstreamErrorKind } from "@/server/llm-gateway/engine/host/errorJudge";
import { markAccountUnavailable } from "@/server/llm-gateway/auth/accountSelection";
import { handleNoAuthCooldownResult, isNoAuthOnCooldown } from "@/server/llm-gateway/application/noAuthCooldown";

const LONG_COOLDOWN_MS = 2 * 60 * 1000;
const TRANSIENT_COOLDOWN_MS = 30 * 1000;
const NOAUTH_PROVIDER = "duckai";

function judged(kind: UpstreamErrorKind): ErrorJudgement {
  return { kind, confidence: 0.9 };
}

beforeEach(() => {
  availabilityStore.clear();
  setModelAvailability.mockClear();
  getProviderConnections.mockReset();
  getProviderConnections.mockResolvedValue([{ id: "conn-1", displayName: "TestConn", backoffLevel: 0 }]);
  setErrorJudge(null);
});

afterEach(() => setErrorJudge(null));

describe("fallbackDecisionFromJudgement (G2.2 kind map)", () => {
  it.each([["rate_limit"], ["quota"], ["capacity"]] as const)(
    "backs off exponentially for %s, like the backoff rules did",
    (kind) => {
      expect(fallbackDecisionFromJudgement(judged(kind), 0)).toEqual({
        shouldFallback: true,
        cooldownMs: 2000,
        newBackoffLevel: 1,
      });
      // Level 3 → level 4 → base * 2^3
      expect(fallbackDecisionFromJudgement(judged(kind), 3).cooldownMs).toBe(16_000);
    },
  );

  it.each([["auth_expired"], ["billing"], ["permanent"]] as const)(
    "locks the account for the long cooldown on %s",
    (kind) => {
      expect(fallbackDecisionFromJudgement(judged(kind), 0)).toEqual({
        shouldFallback: true,
        cooldownMs: LONG_COOLDOWN_MS,
      });
    },
  );

  it("keeps github_monthly on the long cooldown (the monthly reset is accountSelection's)", () => {
    expect(fallbackDecisionFromJudgement(judged("github_monthly"), 0)).toEqual({
      shouldFallback: true,
      cooldownMs: LONG_COOLDOWN_MS,
    });
  });

  it("rotates on transient with only the transient cooldown", () => {
    expect(fallbackDecisionFromJudgement(judged("transient"), 0)).toEqual({
      shouldFallback: true,
      cooldownMs: TRANSIENT_COOLDOWN_MS,
    });
  });

  it("does not punish the account for one refused prompt (moderation → transient, not 2min)", () => {
    expect(fallbackDecisionFromJudgement(judged("moderation"), 0)).toEqual({
      shouldFallback: true,
      cooldownMs: TRANSIENT_COOLDOWN_MS,
    });
  });

  it.each([["client_request"], ["tool_unsupported"]] as const)(
    "does not rotate or cool down on %s — the next account reproduces it",
    (kind) => {
      expect(fallbackDecisionFromJudgement(judged(kind), 0)).toEqual({ shouldFallback: false, cooldownMs: 0 });
    },
  );
});

describe("checkFallbackError without a judgement is unchanged", () => {
  it('still backs off on "rate limit" text', () => {
    const result = checkFallbackError(500, "You hit the rate limit", 0);
    expect(result).toEqual({ shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1 });
  });

  it("still backs off on 429 status", () => {
    const result = checkFallbackError(429, "Slow down", 0);
    expect(result).toEqual({ shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1 });
  });

  it("falls back to the transient cooldown for an unmapped error", () => {
    expect(checkFallbackError(502, "Bad Gateway", 0)).toEqual({ shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS });
  });

  it("takes the judgement over the rules when one is present", () => {
    // "rate limit" would back off; the judge says the body is malformed.
    expect(checkFallbackError(500, "You hit the rate limit", 0, judged("client_request")))
      .toEqual({ shouldFallback: false, cooldownMs: 0 });
  });
});

describe("isToolUnsupportedError with a judgement", () => {
  it("answers true on a tool_unsupported verdict even with no matching phrase", () => {
    expect(isToolUnsupportedError("nope", judged("tool_unsupported"))).toBe(true);
  });

  it("keeps the regexes for any other verdict and for none at all", () => {
    expect(isToolUnsupportedError("nope", judged("rate_limit"))).toBe(false);
    expect(isToolUnsupportedError("nope")).toBe(false);
    expect(isToolUnsupportedError("Tools are not supported here", judged("rate_limit"))).toBe(true);
  });
});

describe("judgeUpstreamError", () => {
  it("returns the judge's verdict and serialises objects like the regexes do", async () => {
    const judge = vi.fn(async () => judged("quota"));
    setErrorJudge(judge);
    expect(await judgeUpstreamError({ status: 429, errorText: { message: "spent" }, provider: "claude" }))
      .toEqual(judged("quota"));
    expect(judge).toHaveBeenCalledWith({ status: 429, errorText: '{"message":"spent"}', provider: "claude" });
  });

  it("answers null when no judge is installed, or the judge throws", async () => {
    expect(await judgeUpstreamError({ status: 429, errorText: "x", provider: "claude" })).toBeNull();
    setErrorJudge(async () => { throw new Error("boom"); });
    expect(await judgeUpstreamError({ status: 429, errorText: "x", provider: "claude" })).toBeNull();
  });
});

describe("noAuth cooldown: moderation vs refusal", () => {
  it("cools a moderation-refused 403 down for 30s, not the 1h refusal cooldown", async () => {
    setErrorJudge(async () => judged("moderation"));
    const response = await handleNoAuthCooldownResult(
      { status: 403, error: "Content refused by safety filters" },
      NOAUTH_PROVIDER,
      "big-pickle",
    );

    expect(response?.status).toBe(403);
    const remaining = await isNoAuthOnCooldown(NOAUTH_PROVIDER);
    expect(remaining).toBeGreaterThan(29 * 1000);
    expect(remaining).toBeLessThanOrEqual(30 * 1000);
  });

  it("keeps the 1h refusal cooldown when the judge is silent", async () => {
    setErrorJudge(null);
    const response = await handleNoAuthCooldownResult(
      { status: 403, error: "OpenCode's free tier can only be used from within OpenCode" },
      NOAUTH_PROVIDER,
      "big-pickle",
    );

    expect(response?.status).toBe(403);
    const remaining = await isNoAuthOnCooldown(NOAUTH_PROVIDER);
    expect(remaining).toBeGreaterThan(59 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe("github_monthly via the judge", () => {
  const nextMonthUtc = () => {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  };

  it("locks __all until the 1st of next month from the verdict alone (no keyword)", async () => {
    await markAccountUnavailable("conn-1", 402, "something went wrong", "github", "gpt-5", null, judged("github_monthly"));

    expect(setModelAvailability).toHaveBeenCalledTimes(1);
    const input = setModelAvailability.mock.calls[0]![0] as { connectionId: string; modelId: string; until: string };
    expect(input).toMatchObject({ connectionId: "conn-1", modelId: "__all" });
    // `until` is rebuilt from Date.now() on the way out, so allow clock drift.
    expect(Math.abs(Date.parse(input.until) - nextMonthUtc())).toBeLessThan(5_000);
  });

  it("still recognises the monthly-limit keyword without any judgement", async () => {
    await markAccountUnavailable("conn-1", 402, "You've reached your additional usage limit for your plan", "github", "gpt-5", null, null);

    const input = setModelAvailability.mock.calls[0]![0] as { modelId: string; until: string };
    expect(input.modelId).toBe("__all");
    expect(Math.abs(Date.parse(input.until) - nextMonthUtc())).toBeLessThan(5_000);
  });

  it("keeps the ordinary cooldown map when the judge says something else", async () => {
    await markAccountUnavailable("conn-1", 402, "something went wrong", "github", "gpt-5", null, judged("billing"));

    const input = setModelAvailability.mock.calls[0]![0] as { modelId: string; until: string };
    expect(input.modelId).toBe("gpt-5");
    // billing → COOLDOWN.long (2min), not the monthly reset
    expect(Date.parse(input.until)).toBeGreaterThan(Date.now() + LONG_COOLDOWN_MS - 5_000);
    expect(Date.parse(input.until)).toBeLessThanOrEqual(Date.now() + LONG_COOLDOWN_MS);
  });

  it("uses the transient cooldown for a judged moderation instead of the 403 long lock", async () => {
    await markAccountUnavailable("conn-1", 403, "content refused", "claude", "sonnet", null, judged("moderation"));

    const input = setModelAvailability.mock.calls[0]![0] as { modelId: string; until: string };
    expect(Date.parse(input.until)).toBeGreaterThan(Date.now() + TRANSIENT_COOLDOWN_MS - 5_000);
    expect(Date.parse(input.until)).toBeLessThanOrEqual(Date.now() + TRANSIENT_COOLDOWN_MS);
  });
});
