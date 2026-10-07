import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * On a free-tier account fetchAvailableModels reports misleading per-model
 * quota (a missing fraction reads as 0%), so only the weekly summary is shown.
 * Paid accounts keep the per-model rows and gain the weekly/5h rows, with the
 * 5h row reconciled when every model in the family is exhausted.
 */
let tier: { id: string };
vi.mock("@/server/llm-gateway/engine/services/usage/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWithTimeout: vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("loadCodeAssist")) {
      return json({ cloudaicompanionProject: "p-1", currentTier: { name: "Plan" }, paidTier: tier });
    }
    if (url.includes("fetchAvailableModels")) {
      return json({ models: { "gemini-3.1-pro-low": { displayName: "Pro", quotaInfo: { remainingFraction: 0, resetTime: "2026-10-07T18:00:00Z" } } } });
    }
    return json({ groups: [{ displayName: "Gemini", buckets: [
      { window: "weekly", remainingFraction: 0.5 },
      { window: "5h", remainingFraction: 0.8 },
    ] }] });
  }),
}));

import { getAntigravityUsage } from "@/server/llm-gateway/engine/services/usage/google";
import { _clearWeeklyCache } from "@/server/llm-gateway/engine/services/usage/antigravity-weekly";

beforeEach(() => _clearWeeklyCache());

describe("getAntigravityUsage", () => {
  it("shows only the weekly quota for a free-tier account", async () => {
    tier = { id: "free-tier" };

    const usage = await getAntigravityUsage("token", {}) as { quotas: Record<string, unknown> };

    expect(Object.keys(usage.quotas).sort()).toEqual(["gemini_session", "gemini_weekly"]);
  });

  it("keeps per-model rows for a paid account and zeroes the 5h row when the family is exhausted", async () => {
    tier = { id: "g1-pro-tier" };

    const usage = await getAntigravityUsage("token", {}) as { quotas: Record<string, { remainingPercentage: number; resetAt?: string | null }> };

    expect(usage.quotas).toHaveProperty("gemini-3.1-pro-low");
    expect(usage.quotas.gemini_weekly.remainingPercentage).toBe(50);
    expect(usage.quotas.gemini_session.remainingPercentage).toBe(0);
    expect(usage.quotas.gemini_session.resetAt).toBe("2026-10-07T18:00:00.000Z");
  });
});
