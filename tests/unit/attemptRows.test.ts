import { describe, expect, it } from "vitest";
import { buildAttemptRows } from "@/app/(dashboard)/dashboard/usage/components/requests/attemptRows";

describe("buildAttemptRows", () => {
  it("returns nothing without attempts", () => {
    expect(buildAttemptRows(undefined)).toEqual([]);
    expect(buildAttemptRows([])).toEqual([]);
  });

  it("numbers rows, tones them and points each failure at the next model", () => {
    const rows = buildAttemptRows([
      { model: "zai/glm", outcome: "failed", status: 429 },
      { model: "oc/x", outcome: "cooldown_skip" },
      { model: "mimo/flash", outcome: "ok", status: 200 },
    ]);
    expect(rows.map((r) => [r.number, r.tone, r.badge])).toEqual([
      [1, "failed", "429"],
      [2, "skipped", "cooldown"],
      [3, "ok", "200"],
    ]);
    expect(rows[0].fallbackTo).toEqual({ model: "oc/x", number: 2 });
    expect(rows[1].fallbackTo).toEqual({ model: "mimo/flash", number: 3 });
    expect(rows[2].fallbackTo).toBeUndefined();
  });

  it("does not invent a fallback after the last failure", () => {
    const rows = buildAttemptRows([{ model: "a/m", outcome: "failed", status: 503 }]);
    expect(rows[0].fallbackTo).toBeUndefined();
  });
});
