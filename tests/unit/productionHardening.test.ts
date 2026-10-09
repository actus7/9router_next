import { beforeEach, describe, expect, it, vi } from "vitest";

const recordModelAttempt = vi.fn(async () => {});
const readModelPerf = vi.fn(async (): Promise<unknown[]> => []);
const pruneModelPerf = vi.fn(async () => {});
vi.mock("@/lib/db/repos/modelPerfRepo", () => ({
  recordModelAttempt: (...a: unknown[]) => recordModelAttempt(...(a as [])),
  readModelPerf: () => readModelPerf(),
  pruneModelPerf: () => pruneModelPerf(),
}));
let tenant: string | null = "t1";
vi.mock("@/lib/db/tenant", () => ({ tryCurrentTenantId: () => tenant }));
const waitUntil = vi.fn();
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => waitUntil(p) }));

import { installModelStatsStore, resetModelStatsCache } from "@/server/llm-gateway/application/modelStatsStore";
import { loadModelStats, recordAttemptDatum, setModelStatsStore } from "@/server/llm-gateway/engine/host/modelStats";
import { redactSecrets, truncateTraceError } from "@/shared/observability/routingTrace";
import { clearModelPenalties, getStickyModel, rememberStickyModel } from "@/server/llm-gateway/engine/services/modelPenalty";
import { recordFailedRequest } from "@/server/llm-gateway/application/failedRequestUsage";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";

describe("model stats store under load", () => {
  beforeEach(() => {
    setModelStatsStore(null);
    resetModelStatsCache();
    recordModelAttempt.mockClear();
    readModelPerf.mockReset();
    readModelPerf.mockResolvedValue([]);
    pruneModelPerf.mockClear();
    waitUntil.mockClear();
    tenant = "t1";
    installModelStatsStore();
  });

  it("shares one read between concurrent callers on a cold cache", async () => {
    let release!: () => void;
    readModelPerf.mockImplementation(() => new Promise((resolve) => { release = () => resolve([]); }));
    const calls = Promise.all([loadModelStats(), loadModelStats(), loadModelStats()]);
    await Promise.resolve();
    release();
    await calls;
    expect(readModelPerf).toHaveBeenCalledTimes(1);
  });

  it("remembers a failed read for a moment instead of retrying on every request", async () => {
    readModelPerf.mockRejectedValue(new Error("neon down"));
    expect((await loadModelStats()).size).toBe(0);
    expect((await loadModelStats()).size).toBe(0);
    expect(readModelPerf).toHaveBeenCalledTimes(1);
  });

  it("keeps the write alive with waitUntil", () => {
    recordAttemptDatum({ modelKey: "a/m", outcome: "ok", ttftMs: 10 });
    expect(recordModelAttempt).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("prunes old rows after a successful read, not on every read", async () => {
    await loadModelStats();
    expect(pruneModelPerf).toHaveBeenCalledTimes(1);
    // A second read for the same tenant inside the prune interval does not prune again.
    readModelPerf.mockResolvedValue([]);
    (await import("@/server/llm-gateway/application/modelStatsStore")).resetModelStatsCache;
    await loadModelStats();
    expect(pruneModelPerf).toHaveBeenCalledTimes(1);
  });
});

describe("secrets never reach the persisted trace", () => {
  it.each([
    ["Incorrect API key provided: sk-proj-abcdefghijklmnop1234", "sk-proj-abcdefghijklmnop1234"],
    ["Authorization: Bearer abcdef1234567890abcdef", "abcdef1234567890abcdef"],
    ["bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r", "eyJhbGciOiJIUzI1NiJ9"],
    ["key AIzaSyA-abcdefghijklmnopqrstuvwxyz0123 rejected", "AIzaSyA-abcdefghijklmnopqrstuvwxyz0123"],
  ])("scrubs %s", (text, secret) => {
    expect(redactSecrets(text)).not.toContain(secret);
    expect(truncateTraceError(text)).not.toContain(secret);
    expect(truncateTraceError(text)).toContain("[redacted]");
  });

  it("leaves an ordinary upstream message alone", () => {
    expect(redactSecrets("Rate limit exceeded, retry in 20s")).toBe("Rate limit exceeded, retry in 20s");
  });
});

describe("sticky model memory is bounded", () => {
  beforeEach(() => clearModelPenalties());

  it("does not grow without limit with many distinct sessions", () => {
    for (let i = 0; i < 6000; i++) rememberStickyModel(`s${i}`, "dev", "b/m", i);
    expect(getStickyModel("s5999", "dev", 6000)).toBe("b/m");
    expect(getStickyModel("s0", "dev", 6000)).toBeUndefined();
  });
});

describe("failed usage rows are only for outcomes worth recording", () => {
  it.each([[400, false], [401, false], [403, false], [404, false], [422, false], [429, true], [500, true], [503, true], [504, true]])(
    "status %s → recorded=%s",
    async (status, recorded) => {
      const saved = vi.fn(async () => 1);
      vi.resetModules();
      vi.doMock("@/lib/usageDb", () => ({ saveRequestUsage: saved }));
      const mod = await import("@/server/llm-gateway/application/failedRequestUsage");
      const { startRoutingTrace } = await import("@/server/llm-gateway/engine/services/routingTrace");
      const body = startRoutingTrace({} as Record<string, unknown>, "dev");
      await mod.recordFailedRequest({ body, response: new Response("{}", { status }), requested: "dev", apiKey: null });
      expect(saved).toHaveBeenCalledTimes(recorded ? 1 : 0);
    },
  );
  it("exports the same function the chat path uses", () => expect(typeof recordFailedRequest).toBe("function"));
});

describe("sticky renews while it keeps answering", () => {
  beforeEach(() => clearModelPenalties());
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  it("extends the 30 minutes when the sticky model itself answers", async () => {
    const fail = () => new Response("{}", { status: 503 });
    const ok = () => new Response("{}", { status: 200 });
    await handleComboChat({ body: {}, models: ["a/m", "b/m"], handleSingleModel: async (_b, m) => (m === "a/m" ? fail() : ok()), log, comboName: "dev", autoSwitch: false, adaptive: true, sessionKey: "s" });
    const first = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(first + 25 * 60_000);
    await handleComboChat({ body: {}, models: ["a/m", "b/m"], handleSingleModel: async () => ok(), log, comboName: "dev", autoSwitch: false, adaptive: true, sessionKey: "s" });
    vi.setSystemTime(first + 50 * 60_000);
    expect(getStickyModel("s", "dev")).toBe("b/m");
    vi.useRealTimers();
  });
});
