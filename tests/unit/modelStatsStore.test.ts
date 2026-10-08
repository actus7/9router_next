import { beforeEach, describe, expect, it, vi } from "vitest";

const recordModelAttempt = vi.fn(async () => {});
const pruneModelPerf = vi.fn(async () => {});
const readModelPerf = vi.fn(async () => [
  { modelKey: "a/m", hourKey: new Date().toISOString().slice(0, 13), ok: 10, fail: 0, timeout: 0, b: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
]);
let tenant: string | null = "t1";
vi.mock("@/lib/db/repos/modelPerfRepo", () => ({
  recordModelAttempt: (...a: unknown[]) => recordModelAttempt(...(a as [])),
  readModelPerf: (...a: unknown[]) => readModelPerf(...(a as [])),
  pruneModelPerf: () => pruneModelPerf(),
}));
vi.mock("@/lib/db/tenant", () => ({ tryCurrentTenantId: () => tenant }));

import { installModelStatsStore, resetModelStatsCache } from "@/server/llm-gateway/application/modelStatsStore";
import { loadModelStats, recordAttemptDatum, setModelStatsStore } from "@/server/llm-gateway/engine/host/modelStats";

describe("modelStatsStore", () => {
  beforeEach(() => {
    setModelStatsStore(null);
    resetModelStatsCache();
    recordModelAttempt.mockClear();
    readModelPerf.mockClear();
    tenant = "t1";
  });

  it("is inert until installed", async () => {
    recordAttemptDatum({ modelKey: "a/m", outcome: "ok" });
    expect((await loadModelStats()).size).toBe(0);
    expect(recordModelAttempt).not.toHaveBeenCalled();
  });

  it("records attempts through the repo", () => {
    installModelStatsStore();
    recordAttemptDatum({ modelKey: "a/m", outcome: "ok", ttftMs: 120 });
    expect(recordModelAttempt).toHaveBeenCalledWith({ modelKey: "a/m", outcome: "ok", ttftMs: 120 });
  });

  it("swallows a failing write", () => {
    recordModelAttempt.mockRejectedValueOnce(new Error("db"));
    installModelStatsStore();
    expect(() => recordAttemptDatum({ modelKey: "a/m", outcome: "fail" })).not.toThrow();
  });

  it("aggregates once per minute per tenant", async () => {
    installModelStatsStore();
    const first = await loadModelStats();
    await loadModelStats();
    expect(readModelPerf).toHaveBeenCalledTimes(1);
    expect(first.get("a/m")!.okW).toBeGreaterThan(9);
    tenant = "t2";
    await loadModelStats();
    expect(readModelPerf).toHaveBeenCalledTimes(2);
  });

  it("answers empty when there is no tenant or the read fails", async () => {
    installModelStatsStore();
    tenant = null;
    expect((await loadModelStats()).size).toBe(0);
    tenant = "t3";
    readModelPerf.mockRejectedValueOnce(new Error("db"));
    expect((await loadModelStats()).size).toBe(0);
  });
});
