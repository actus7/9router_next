import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { getFirstByteBudget } from "@/server/llm-gateway/engine/utils/firstByteGuard";
import { setModelStatsStore, type AttemptDatum } from "@/server/llm-gateway/engine/host/modelStats";
import type { ModelStat } from "@/shared/observability/modelStats";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const ok = () => new Response("{}", { status: 200 });
const fail = (status: number, message = "x") => new Response(JSON.stringify({ error: { message } }), { status });

describe("combo feeds and reads the model stats", () => {
  let recorded: AttemptDatum[];
  let stats: Map<string, ModelStat>;

  beforeEach(() => {
    recorded = [];
    stats = new Map();
    setModelStatsStore({ record: (d) => recorded.push(d), read: async () => stats });
  });
  afterEach(() => setModelStatsStore(null));

  it("records ok with its time, failures, and timeouts apart", async () => {
    await handleComboChat({
      body: {},
      models: ["a/m", "b/m", "c/m"],
      handleSingleModel: async (_b, m) => (m === "a/m" ? fail(503) : m === "b/m" ? fail(504, "gateway timeout") : ok()),
      log,
      autoSwitch: false,
    });
    expect(recorded.map((d) => [d.modelKey, d.outcome])).toEqual([["a/m", "fail"], ["b/m", "timeout"], ["c/m", "ok"]]);
    expect(typeof recorded[2].ttftMs).toBe("number");
  });

  it("records neither a refused request nor a cooldown skip", async () => {
    const retryAfter = new Date(Date.now() + 60_000).toISOString();
    await handleComboChat({
      body: {},
      models: ["a/m", "b/m", "c/m"],
      handleSingleModel: async (_b, m) =>
        m === "a/m" ? fail(400, "bad body")
          : m === "b/m" ? new Response(JSON.stringify({ error: { message: "locked" }, retryAfter }), { status: 429 })
          : ok(),
      log,
      autoSwitch: false,
    });
    expect(recorded.map((d) => d.modelKey)).toEqual(["c/m"]);
  });

  it("gives a historically slow model more patience for the first byte", async () => {
    stats.set("slow/m", { okW: 50, failW: 0, ttftW: 50, ttftSamples: 50, samples: 50, p50Ms: 40_000, p95Ms: 64_000 });
    const seen: Record<string, number | undefined> = {};
    await handleComboChat({
      body: {},
      models: ["slow/m", "fast/m", "last/m"],
      handleSingleModel: async (b, m) => {
        seen[m] = getFirstByteBudget(b);
        return m === "last/m" ? ok() : fail(503);
      },
      log,
      autoSwitch: false,
      comboFirstByteBudgetMs: 60_000,
    });
    expect(seen).toEqual({ "slow/m": 74_000, "fast/m": 60_000, "last/m": undefined });
  });
});
