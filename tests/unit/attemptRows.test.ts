import { describe, expect, it } from "vitest";
import { buildAttemptRows, readableError, summarizeAttempts } from "@/app/(dashboard)/dashboard/usage/components/requests/attemptRows";

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
    expect(rows[0].fallbackTo).toEqual({ model: "oc/x", number: 2, sameModel: false });
    expect(rows[1].fallbackTo).toEqual({ model: "mimo/flash", number: 3, sameModel: false });
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

describe("free fallback", () => {
  it("carries the flag so the panel can say who really answered", () => {
    const rows = buildAttemptRows([
      { model: "glm/flash", outcome: "failed", status: 429 },
      { model: "kilo-gateway/kilo-auto/free", outcome: "ok", freeFallback: true },
    ]);
    expect(rows.map((r) => r.freeFallback)).toEqual([false, true]);
    expect(summarizeAttempts(rows).answeredBy?.model).toBe("kilo-gateway/kilo-auto/free");
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

describe("readableError", () => {
  it("pulls the message out of a provider's JSON error body", () => {
    expect(readableError('[429]: {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}'))
      .toBe("Insufficient balance or no resource package. Please recharge.");
    expect(readableError('{"message":"model not found"}')).toBe("model not found");
    expect(readableError('{"error":"quota exceeded"}')).toBe("quota exceeded");
  });

  it("keeps plain text, and a JSON cut short by truncation, as it is", () => {
    expect(readableError("fetch connect timeout")).toBe("fetch connect timeout");
    expect(readableError('[500]: {"error":{"message":"overlo…')).toBe('{"error":{"message":"overlo…');
    expect(readableError(undefined)).toBeUndefined();
  });
});

describe("account switch inside one model", () => {
  it("says the next try was another account of the same model, not a different model", () => {
    const rows = buildAttemptRows([
      { model: "glm/flash", connection: "Z.ai", outcome: "failed", status: 429 },
      { model: "glm/flash", connection: "Z.ai 2", outcome: "ok", status: 200 },
    ]);
    expect(rows[0].fallbackTo).toEqual({ model: "glm/flash", number: 2, sameModel: true });
  });
});
