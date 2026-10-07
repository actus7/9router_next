import { describe, expect, it } from "vitest";

import { parseWeeklyQuotaSummary } from "@/server/llm-gateway/engine/services/usage/antigravity-weekly";

/**
 * retrieveUserQuotaSummary groups quota by model family with a weekly and a 5h
 * window. Free-tier accounts only have the weekly one, so it is the number the
 * quota page must show (ported from decolua/9router).
 */
const summary = {
  groups: [
    {
      displayName: "Gemini models",
      buckets: [
        { window: "weekly", remainingFraction: 0.4, resetTime: "2026-10-12T00:00:00Z" },
        { window: "5h", remainingFraction: 0.9, resetTime: "2026-10-07T15:00:00Z" },
      ],
    },
    {
      displayName: "Claude and GPT models",
      buckets: [{ window: "weekly", remainingFraction: 1 }],
    },
  ],
};

describe("parseWeeklyQuotaSummary", () => {
  it("maps each family and window to a stable key", () => {
    const quotas = parseWeeklyQuotaSummary(summary);

    expect(Object.keys(quotas).sort()).toEqual(["claude_gpt_weekly", "gemini_session", "gemini_weekly"]);
    expect(quotas.gemini_weekly).toMatchObject({ used: 600, total: 1000, remainingPercentage: 40, displayName: "Gemini (Weekly)" });
    expect(quotas.gemini_weekly.resetAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("accepts groups under quotaSummary", () => {
    expect(Object.keys(parseWeeklyQuotaSummary({ quotaSummary: summary }))).toContain("gemini_weekly");
  });

  it("keeps a disabled 5h bucket at 0% but drops a disabled weekly one", () => {
    const quotas = parseWeeklyQuotaSummary({
      groups: [{
        displayName: "Gemini",
        buckets: [
          { window: "weekly", disabled: true, remainingFraction: 0.5 },
          { window: "5h", disabled: true, remainingFraction: 0.5 },
        ],
      }],
    });

    expect(quotas).not.toHaveProperty("gemini_weekly");
    expect(quotas.gemini_session.remainingPercentage).toBe(0);
  });

  it("returns nothing for payloads it does not recognize", () => {
    expect(parseWeeklyQuotaSummary(null)).toEqual({});
    expect(parseWeeklyQuotaSummary({ groups: "x" })).toEqual({});
  });
});
