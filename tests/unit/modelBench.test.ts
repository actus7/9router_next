import { beforeEach, describe, expect, it, vi } from "vitest";

const connections = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
const getProviderConnections = vi.fn(async () => connections);
const getActiveModelAvailability = vi.fn(async (): Promise<Array<{ connectionId: string; until: string }>> => []);
const setModelAvailability = vi.fn(async () => {});

vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections: (...a: unknown[]) => getProviderConnections(...(a as [])) }));
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: (...a: unknown[]) => getActiveModelAvailability(...(a as [])),
  setModelAvailability: (...a: unknown[]) => setModelAvailability(...(a as [])),
}));

import {
  MODEL_BENCH_COOLDOWN_MS,
  MODEL_FAILURE_THRESHOLD,
  MODEL_FAILURE_WINDOW_MS,
  noteBenchFailure,
  noteBenchSuccess,
  resetModelBench,
} from "@/server/llm-gateway/auth/modelBench";

const MIN = 60_000;

describe("model bench", () => {
  beforeEach(() => {
    resetModelBench();
    setModelAvailability.mockClear();
    getActiveModelAvailability.mockReset();
    getActiveModelAvailability.mockResolvedValue([]);
  });

  it("does nothing below the threshold", async () => {
    for (let i = 0; i < MODEL_FAILURE_THRESHOLD - 1; i++) {
      expect(await noteBenchFailure("p", "m", 503, i * MIN)).toBe(false);
    }
    expect(setModelAvailability).not.toHaveBeenCalled();
  });

  it("benches the model on every account at the threshold", async () => {
    let benched = false;
    for (let i = 0; i < MODEL_FAILURE_THRESHOLD; i++) benched = await noteBenchFailure("p", "m", 503, i * MIN);
    expect(benched).toBe(true);
    expect(setModelAvailability).toHaveBeenCalledTimes(connections.length);
    const call = (setModelAvailability.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(call).toMatchObject({ modelId: "m", status: "cooldown" });
    const until = Date.parse(String(call.until));
    expect(until - (MODEL_FAILURE_THRESHOLD - 1) * MIN).toBeGreaterThan(MODEL_BENCH_COOLDOWN_MS - 1000);
  });

  it("ignores failures that fell out of the window", async () => {
    await noteBenchFailure("p", "m", 503, 0);
    await noteBenchFailure("p", "m", 503, 1 * MIN);
    expect(await noteBenchFailure("p", "m", 503, MODEL_FAILURE_WINDOW_MS + 5 * MIN)).toBe(false);
  });

  it("never shortens a longer cooldown an account already has", async () => {
    const now = 10 * MIN;
    getActiveModelAvailability.mockResolvedValue([
      { connectionId: "c1", until: new Date(now + 60 * MIN).toISOString() },
    ]);
    for (let i = 0; i < MODEL_FAILURE_THRESHOLD; i++) await noteBenchFailure("p", "m", 503, now);
    const benchedIds = setModelAvailability.mock.calls.map((c) => ((c as unknown[])[0] as { connectionId: string }).connectionId);
    expect(benchedIds).toEqual(["c2", "c3"]);
  });

  it("a success clears the streak", async () => {
    await noteBenchFailure("p", "m", 503, 0);
    await noteBenchFailure("p", "m", 503, 1);
    noteBenchSuccess("p", "m");
    expect(await noteBenchFailure("p", "m", 503, 2)).toBe(false);
  });

  it("counts models independently", async () => {
    for (let i = 0; i < MODEL_FAILURE_THRESHOLD - 1; i++) await noteBenchFailure("p", "m1", 503, i);
    expect(await noteBenchFailure("p", "m2", 503, 5)).toBe(false);
  });
});
