import { describe, expect, it } from "vitest";
import { buildAttemptRows, summarizeAttempts } from "@/app/(dashboard)/dashboard/usage/components/requests/attemptRows";

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

  it("treats an aborted hedge loser as cancelled, not failed, and flags it as parallel", () => {
    const rows = buildAttemptRows([
      { model: "mimo/pro", outcome: "ok", status: 200, startOffsetMs: 0, durationMs: 9800 },
      { model: "mimo/flash", outcome: "aborted", error: "another model answered first", startOffsetMs: 6000, durationMs: 4300 },
    ]);
    expect(rows[1].tone).toBe("cancelled");
    expect(rows[1].badge).toBe("cancelled");
    expect(rows[1].parallel).toBe(true);
    expect(rows[0].parallel).toBe(false);
    expect(rows[0].fallbackTo).toBeUndefined();
  });

  it("does not call a sequential retry parallel", () => {
    const rows = buildAttemptRows([
      { model: "a", outcome: "failed", status: 429, startOffsetMs: 0, durationMs: 1000 },
      { model: "b", outcome: "ok", status: 200, startOffsetMs: 1000, durationMs: 500 },
    ]);
    expect(rows[1].parallel).toBe(false);
  });
});

describe("summarizeAttempts", () => {
  it("names the answering attempt, counts real failures and spans the whole timeline", () => {
    const rows = buildAttemptRows([
      { model: "a", outcome: "failed", status: 429, startOffsetMs: 0, durationMs: 1000 },
      { model: "b", outcome: "cooldown_skip" },
      { model: "c", outcome: "ok", status: 200, startOffsetMs: 1000, durationMs: 3900 },
      { model: "d", outcome: "aborted", startOffsetMs: 2000, durationMs: 500 },
    ]);
    const s = summarizeAttempts(rows);
    expect(s.answeredBy?.model).toBe("c");
    expect(s.failures).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.totalMs).toBe(4900);
  });

  it("has no answering attempt when everything failed", () => {
    const s = summarizeAttempts(buildAttemptRows([{ model: "a", outcome: "failed", status: 500 }]));
    expect(s.answeredBy).toBeUndefined();
    expect(s.failures).toBe(1);
  });
});
