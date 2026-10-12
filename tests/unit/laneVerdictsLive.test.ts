import { describe, expect, it, vi } from "vitest";

/**
 * The real Jev deciding lanes for a real-shaped inventory (Artificial Analysis
 * rows, index v4.3). Only the settings/connection repos are stubbed; the HTTP
 * call to the gateway and the parsing are real. Skipped unless asked for: it
 * spends AI Gateway quota. Prints the board so calibration can be eyeballed.
 *
 *   NODE_OPTIONS="-r dotenv/config" DOTENV_CONFIG_PATH=.env LIVE_LANES=1 \
 *     npx vitest run tests/unit/laneVerdictsLive.test.ts
 */
const live = !!process.env.LIVE_LANES;

vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({ decisionEngine: "jev", jevSuggestRouting: true })) }));
vi.mock("@/lib/db/repos/decisionKeysRepo", () => ({ getTypesafeKey: vi.fn(async () => process.env.LIVE_TYPESAFE_KEY ?? null) }));
vi.mock("@/server/llm-gateway/chat", () => ({ handleSingleModelChat: vi.fn() }));
vi.mock("server-only", () => ({}));

// slug, intelligence, coding, agentic, $in, $out, tok/s, ttft
const ROWS: Array<[string, number, number | null, number | null, number, number, number, number]> = [
  ["claude-opus-5", 50.8, 78, 56.5, 5, 25, 57.17, 58.26],
  ["gpt-5.6-sol", 47, 77.4, 50.2, 4, 20, 79.39, 112.99],
  ["gpt-5.6-terra", 42.1, 76.7, 43.2, 2, 12, 99.64, 172.69],
  ["gpt-5.6-luna", 37.3, 71.4, 42.1, 0.2, 1.2, 124.81, 109.99],
  ["glm-5.3", 44.8, 74.8, 53.1, 1.4, 4.4, 70.91, 3.32],
  ["mimo-v2.6-pro", 46.3, null, null, 0.43, 0.87, 45.55, 3.95],
  ["mimo-v2.6-flash", 37.9, null, null, 0.14, 0.28, 51.15, 3.91],
  ["qwen3.8-max", 45.4, 76.2, 56, 2, 6, 38.98, 2.68],
  ["qwen3.8-flash-next", 39.8, 73.1, 53.6, 0.15, 0.47, 54.66, 2.47],
  ["gemini-3.1-pro-preview", 29.7, 68.8, 8.2, 2, 12, 114.22, 24.23],
  ["gemini-3.8-flash", 40.9, 76.3, 40.2, 0.75, 3.75, 248.52, 17.74],
  ["deepseek-v4.1-flash", 39.5, null, null, 0.3, 1.2, 213.27, 1.02],
  ["deepseek-v4-pro", 36, 68.8, 41.3, 1.32, 3.96, 106.58, 1.77],
  ["gemini-3.5-flash-lite", 22.2, 49.3, 14.3, 0.3, 2.5, 359.96, 8.93],
];

describe.skipIf(!live)("Jev deciding lanes, live", () => {
  it("answers for the inventory and the role rules still hold", async () => {
    const { assignLanes, allowedLanes } = await import("@/server/llm-gateway/engine/services/smart-routing/laneAssignment");
    const { decideLaneVerdicts, defaultLaneDeciders } = await import("@/server/application/use-cases/smart-routing/laneVerdicts");
    const profiles = ROWS.map(([model, intelligence, coding, agentic, inputUsdPer1M, outputUsdPer1M, outputTokensPerSecond, ttftSeconds]) => ({
      modelKey: `p/${model}`, provider: "p", model, displayName: model,
      capabilities: { serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, tools: true, search: false, reasoning: false, contextWindow: 200_000, maxOutput: 32_000 },
      inputPrice: null, outputPrice: null, quality: 0.8, latencyScore: 0.6, reliabilityScore: 0.72, recommendedTier: "standard", needScores: {},
      source: "deterministic", inventoryFingerprint: model,
      aa: { aaId: model, slug: model, name: model, creator: null, intelligence, coding, agentic, math: null, inputUsdPer1M, outputUsdPer1M, outputTokensPerSecond, ttftSeconds, benchmarkCostUsd: null },
    })) as unknown as Parameters<typeof assignLanes>[0];

    const mechanical = assignLanes(profiles);
    const started = Date.now();
    const { verdicts, counts } = await decideLaneVerdicts(mechanical, allowedLanes(profiles), { ...defaultLaneDeciders(mechanical), llm: null });
    const board = assignLanes(profiles, verdicts);
    const lanes = (tier: string) => board
      .filter((item) => typeof item.laneScores?.[tier as "simple"] === "number")
      .sort((a, b) => (b.laneScores?.[tier as "simple"] ?? 0) - (a.laneScores?.[tier as "simple"] ?? 0))
      .map((item) => `${item.model}(${(item.laneScores?.[tier as "simple"] ?? 0).toFixed(2)}${item.laneSource === "jev" ? "j" : ""})`);
    console.log(`Jev settled ${JSON.stringify(counts)} in ${Date.now() - started}ms`);
    for (const tier of ["simple", "standard", "complex", "reasoning"]) console.log(tier.padEnd(9), lanes(tier).join("  "));

    expect(counts.jev, JSON.stringify(counts)).toBeGreaterThan(0);
    const names = (tier: string) => lanes(tier).map((entry) => entry.replace(/\(.*$/, ""));
    for (const flagship of ["claude-opus-5", "gpt-5.6-sol", "qwen3.8-max"]) expect(names("simple")).not.toContain(flagship);
    for (const small of ["gemini-3.8-flash", "deepseek-v4.1-flash", "gpt-5.6-luna"]) expect(names("reasoning")).not.toContain(small);
  }, 120_000);
});
