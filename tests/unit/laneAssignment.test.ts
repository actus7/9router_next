import { describe, expect, it } from "vitest";
import { assignLanes } from "@/server/llm-gateway/engine/services/smart-routing/laneAssignment";
import type { AaModelMetrics, RoutingTier, SmartModelProfile } from "@/shared/llm-catalog";

/**
 * Lane assignment for "Suggest models with AI", driven by the cases an operator
 * flagged on the real board (2026-10): flagships in Simple, older generations
 * ahead of newer ones, guesses outranking measurements. Metrics are real rows
 * from the Artificial Analysis snapshot (index v4.3).
 */

type Row = [string, number | null, number | null, number | null, number, number, number, number];
// slug, intelligence, coding, agentic, $in, $out, tok/s, ttft
const AA_ROWS: Record<string, Row> = {
  "claude-opus-5": ["claude-opus-5", 50.8, 78, 56.5, 5, 25, 57.17, 58.26],
  "claude-opus-4.8": ["claude-opus-4-8", 41.8, 74.3, 41.9, 5, 25, 61.2, 63.28],
  "gpt-5.6-sol": ["gpt-5-6-sol", 47, 77.4, 50.2, 4, 20, 79.39, 112.99],
  "gpt-5.6-terra": ["gpt-5-6-terra", 42.1, 76.7, 43.2, 2, 12, 99.64, 172.69],
  "gpt-5.6-luna": ["gpt-5-6-luna", 37.3, 71.4, 42.1, 0.2, 1.2, 124.81, 109.99],
  "glm-5.3": ["glm-5-3", 44.8, 74.8, 53.1, 1.4, 4.4, 70.91, 3.32],
  "mimo-v2.6-pro": ["mimo-v2-6-pro", 46.3, null, null, 0.43, 0.87, 45.55, 3.95],
  "mimo-v2.6-flash": ["mimo-v2-6-flash", 37.9, null, null, 0.14, 0.28, 51.15, 3.91],
  "mimo-v2.5-pro": ["mimo-v2-5-pro", 26, 60.2, 21.3, 0.43, 0.87, 33.84, 2.24],
  "qwen3.8-max": ["qwen3-8-max", 45.4, 76.2, 56, 2, 6, 38.98, 2.68],
  "qwen3.8-flash-next": ["qwen3-8-flash-next", 39.8, 73.1, 53.6, 0.15, 0.47, 54.66, 2.47],
  "gemini-3.1-pro-preview": ["gemini-3-1-pro-preview", 29.7, 68.8, 8.2, 2, 12, 114.22, 24.23],
  "gemini-2.5-pro": ["gemini-2-5-pro", 16.1, 33.3, 1.6, 1.25, 10, 124.06, 22.9],
  "gemini-3.8-flash": ["gemini-3-8-flash", 40.9, 76.3, 40.2, 0.75, 3.75, 248.52, 17.74],
  "deepseek-v4.1-flash": ["deepseek-v4-1-flash", 39.5, null, null, 0.3, 1.2, 213.27, 1.02],
  "deepseek-v4-pro": ["deepseek-v4-pro", 36, 68.8, 41.3, 1.32, 3.96, 106.58, 1.77],
  "gemini-3.5-flash-lite": ["gemini-3-5-flash-lite", 22.2, 49.3, 14.3, 0.3, 2.5, 359.96, 8.93],
};

function aa(row: Row): AaModelMetrics {
  const [slug, intelligence, coding, agentic, inputUsdPer1M, outputUsdPer1M, outputTokensPerSecond, ttftSeconds] = row;
  return { aaId: slug, slug, name: slug, creator: null, intelligence, coding, agentic, math: null, inputUsdPer1M, outputUsdPer1M, outputTokensPerSecond, ttftSeconds, benchmarkCostUsd: null };
}

function profile(model: string, overrides: Partial<SmartModelProfile> = {}): SmartModelProfile {
  const row = AA_ROWS[model];
  return {
    modelKey: `p/${model}`,
    provider: "p",
    model,
    displayName: model,
    capabilities: { serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, tools: true, search: false, reasoning: false, contextWindow: 200_000, maxOutput: 32_000 },
    inputPrice: null,
    outputPrice: null,
    quality: 0.8,
    latencyScore: 0.6,
    reliabilityScore: 0.72,
    recommendedTier: "standard",
    needScores: {},
    source: "deterministic",
    inventoryFingerprint: model,
    ...(row ? { aa: aa(row) } : {}),
    ...overrides,
  };
}

const inventory = Object.keys(AA_ROWS).map((model) => profile(model));

function lane(result: SmartModelProfile[], tier: RoutingTier, by: "laneScores" | "laneQuality" = "laneScores"): string[] {
  return result
    .filter((item) => typeof item[by]?.[tier] === "number")
    .sort((a, b) => (b[by]?.[tier] ?? 0) - (a[by]?.[tier] ?? 0))
    .map((item) => item.model);
}

describe("assignLanes", () => {
  const result = assignLanes(inventory);

  it("drops an older generation when a newer one of the same family measures at least as well", () => {
    const models = result.map((item) => item.model);
    expect(models).not.toContain("mimo-v2.5-pro");
    expect(models).not.toContain("gemini-2.5-pro");
    expect(models).not.toContain("claude-opus-4.8");
    expect(models).toContain("mimo-v2.6-pro");
    expect(models).toContain("gemini-3.1-pro-preview");
  });

  it("keeps flagships out of Simple and fills it with cheap, fast models", () => {
    const simple = lane(result, "simple");
    for (const flagship of ["claude-opus-5", "gpt-5.6-sol", "gpt-5.6-terra", "qwen3.8-max"]) {
      expect(simple).not.toContain(flagship);
    }
    expect(simple.slice(0, 4)).toEqual(expect.arrayContaining(["deepseek-v4.1-flash"]));
  });

  it("puts the strongest measured models in Reasoning, best first under the quality preset", () => {
    const reasoning = lane(result, "reasoning", "laneQuality");
    expect(reasoning[0]).toBe("claude-opus-5");
    expect(reasoning).toEqual(expect.arrayContaining(["gpt-5.6-sol", "mimo-v2.6-pro", "qwen3.8-max", "glm-5.3"]));
    expect(reasoning).not.toContain("gemini-3.5-flash-lite");
  });

  it("keeps small variants (flash, mini, lite, luna) out of Reasoning however well they measure", () => {
    const reasoning = lane(result, "reasoning");
    for (const small of ["qwen3.8-flash-next", "mimo-v2.6-flash", "gemini-3.8-flash", "deepseek-v4.1-flash", "gpt-5.6-luna"]) {
      expect(reasoning).not.toContain(small);
    }
  });

  it("keeps full-size frontier models out of Simple even when they are cheap", () => {
    // GLM-5.3 and MiMo V2.6 Pro are cheap, but they are the flagships of their families.
    const simple = lane(result, "simple");
    expect(simple).not.toContain("glm-5.3");
    expect(simple).not.toContain("mimo-v2.6-pro");
  });

  it("never puts a model named as a flagship tier (pro, max, opus…) in Simple, even a weak one", () => {
    // Unmeasured entries (neutral price, discounted speed) shift the economy
    // percentiles the way a real inventory does.
    const unmeasured = ["auto", "space-bunny-free", "fugu-max", "fugu-ultra", "hy4-preview", "chat"].map((model) => profile(model, { quality: 0.58 }));
    const simple = lane(assignLanes([...inventory, ...unmeasured]), "simple");
    expect(simple).not.toContain("deepseek-v4-pro");
    expect(simple).not.toContain("gemini-3.1-pro-preview");
    expect(simple).not.toContain("fugu-max");
  });

  it("lets one model serve several lanes", () => {
    const mimo = result.find((item) => item.model === "mimo-v2.6-pro");
    expect(Object.keys(mimo?.laneScores ?? {}).length).toBeGreaterThan(1);
  });

  it("orders Balanced and Highest quality differently where cost and speed matter", () => {
    expect(lane(result, "reasoning", "laneScores")).not.toEqual(lane(result, "reasoning", "laneQuality"));
  });

  it("sets recommendedTier to the lane where the model scores best", () => {
    for (const item of result) {
      const scores = item.laneScores ?? {};
      const best = (Object.keys(scores) as RoutingTier[]).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))[0];
      if (best) expect(item.recommendedTier).toBe(best);
    }
  });
});

describe("assignLanes without measurements", () => {
  it("never lets a guessed model outrank the measured ones in Complex or Reasoning", () => {
    const guessed = profile("fugu-ultra", { quality: 0.8 });
    const result = assignLanes([...inventory, guessed]);
    const fugu = result.find((item) => item.model === "fugu-ultra");
    expect(fugu?.scoreSource).toBe("estimated");
    expect(lane(result, "reasoning")).not.toContain("fugu-ultra");
    expect(lane(result, "complex")).not.toContain("fugu-ultra");
  });

  it("estimates an unmeasured model from a measured sibling of its family", () => {
    const result = assignLanes([...inventory, profile("claude-opus-5.1")]);
    const sibling = result.find((item) => item.model === "claude-opus-5.1");
    const measured = result.find((item) => item.model === "claude-opus-5");
    expect(sibling?.scoreSource).toBe("estimated");
    expect(sibling?.laneQuality?.complex).toBeCloseTo((measured?.laneQuality?.complex ?? 0) * 0.9, 5);
  });

  it("still fills every lane for a tiny inventory", () => {
    const result = assignLanes([profile("glm-5.3"), profile("mimo-v2.6-flash")]);
    for (const tier of ["simple", "standard", "complex", "reasoning"] as RoutingTier[]) {
      expect(lane(result, tier).length).toBeGreaterThan(0);
    }
  });

  it("tags each profile with its canonical key so the board can cap copies", () => {
    const result = assignLanes([profile("mimo-v2.6-pro"), profile("mimo-v2.6-pro", { modelKey: "q/mimo-v2.6-pro:free", model: "mimo-v2.6-pro:free" })]);
    expect(new Set(result.map((item) => item.canonicalKey)).size).toBe(1);
  });
});
