import { describe, expect, it } from "vitest";

/**
 * AA scoring: per-tier weights over measured metrics, normalized against the
 * shortlist being scored. Cheap+fast must win the lanes that pay for speed and
 * cost; raw intelligence must win the lanes that buy quality; missing metrics
 * degrade to the deterministic scores instead of crashing or skewing.
 */

import {
  AA_TIER_WEIGHTS,
  attachAaScoresAndReasons,
  buildAaSuggestionReason,
  computeAaTierScores,
} from "@/server/llm-gateway/engine/services/smart-routing/aaScoring";
import { ROUTING_TIERS } from "@/server/llm-gateway/engine/services/smart-routing/types";
import type { AaModelMetrics, RoutingTier, SmartModelProfile } from "@/server/llm-gateway/engine/services/smart-routing/types";

function profile(modelKey: string, overrides: Partial<SmartModelProfile> = {}): SmartModelProfile {
  return {
    modelKey,
    provider: "oc",
    model: modelKey.slice(3),
    displayName: modelKey,
    capabilities: { serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, tools: true, search: false, reasoning: false, contextWindow: 1, maxOutput: 1 },
    inputPrice: null,
    outputPrice: null,
    quality: 0.6,
    latencyScore: 0.7,
    reliabilityScore: 0.8,
    recommendedTier: "standard",
    needScores: {},
    source: "deterministic",
    inventoryFingerprint: "test",
    ...overrides,
  };
}

function aaMetrics(overrides: Partial<AaModelMetrics> = {}): AaModelMetrics {
  return {
    aaId: "aa-1",
    slug: "model",
    name: "Model",
    creator: null,
    intelligence: null,
    coding: null,
    agentic: null,
    math: null,
    inputUsdPer1M: null,
    outputUsdPer1M: null,
    outputTokensPerSecond: null,
    ttftSeconds: null,
    benchmarkCostUsd: null,
    ...overrides,
  };
}

// Cheap and fast, but weak; dear and slow, but smart. Whichever way a tier
// leans, one of the two must win it cleanly.
const cheapFast = profile("oc/cheap-fast", {
  aa: aaMetrics({
    intelligence: 30, coding: 25, agentic: 20,
    inputUsdPer1M: 0.1, outputUsdPer1M: 0.1,
    outputTokensPerSecond: 500, ttftSeconds: 0.2,
  }),
});
const dearSlow = profile("oc/dear-slow", {
  aa: aaMetrics({
    intelligence: 90, coding: 85, agentic: 80,
    inputUsdPer1M: 10, outputUsdPer1M: 10,
    outputTokensPerSecond: 50, ttftSeconds: 2,
  }),
});

describe("AA_TIER_WEIGHTS", () => {
  it("sums to 1 for every tier", () => {
    for (const tier of ROUTING_TIERS) {
      const weights = AA_TIER_WEIGHTS[tier];
      const sum = weights.quality + weights.speed + weights.cost + weights.latency;
      expect(sum, tier).toBeCloseTo(1, 10);
    }
  });
});

describe("computeAaTierScores", () => {
  it("lets the cheap and fast model win the simple lane", () => {
    const scores = computeAaTierScores([cheapFast, dearSlow]);

    expect(scores["oc/cheap-fast"].simple).toBeGreaterThan(scores["oc/dear-slow"].simple);
  });

  it("lets raw intelligence win the complex and reasoning lanes", () => {
    const scores = computeAaTierScores([cheapFast, dearSlow]);

    for (const tier of ["complex", "reasoning"] as RoutingTier[]) {
      expect(scores["oc/dear-slow"][tier], tier).toBeGreaterThan(scores["oc/cheap-fast"][tier]);
    }
  });

  it("falls back to the deterministic scores and stays neutral without metrics", () => {
    // No AA metrics, no prices: quality/latencyScore keep their slots and cost
    // is the neutral 0.5 — the simple score is exactly the weighted mix.
    const plain = profile("oc/plain");
    const scores = computeAaTierScores([plain]);

    expect(scores["oc/plain"].simple).toBeCloseTo(0.2 * 0.6 + 0.3 * 0.7 + 0.35 * 0.5 + 0.15 * 0.7, 10);
    for (const tier of ROUTING_TIERS) {
      expect(scores["oc/plain"][tier], tier).toBeGreaterThanOrEqual(0);
      expect(scores["oc/plain"][tier], tier).toBeLessThanOrEqual(1);
    }
  });

  it("scores mixed inventories and an empty one without crashing", () => {
    const mixed = computeAaTierScores([cheapFast, profile("oc/plain")]);
    expect(mixed["oc/cheap-fast"].standard).toBeGreaterThan(0);
    expect(mixed["oc/plain"].standard).toBeGreaterThan(0);

    expect(computeAaTierScores([])).toEqual({});
  });
});

describe("buildAaSuggestionReason", () => {
  it("quotes the key numbers that exist", () => {
    const rich = profile("oc/rich", {
      aa: aaMetrics({
        intelligence: 63, coding: 56, agentic: 48,
        inputUsdPer1M: 0.8, outputUsdPer1M: 1.04,
        outputTokensPerSecond: 154, ttftSeconds: 0.9,
      }),
    });

    const reason = buildAaSuggestionReason(rich, "complex");

    expect(reason).toContain("AA intel 63");
    expect(reason).toContain("code 56");
    expect(reason).toContain("agentic 48");
    expect(reason).toContain("154 tok/s");
    expect(reason).toContain("TTFT 0.9s");
    expect(reason).toContain("$0.86/1M blended (3:1)");
  });

  it("returns undefined without AA metrics", () => {
    expect(buildAaSuggestionReason(profile("oc/plain"), "simple")).toBeUndefined();
    expect(buildAaSuggestionReason(profile("oc/no-metrics", { aa: aaMetrics() }), "simple")).toBeUndefined();
  });
});

describe("attachAaScoresAndReasons", () => {
  it("fills aaScores for the four tiers and a reason, and skips the rest", () => {
    const withAa = profile("oc/cheap-fast", { recommendedTier: "simple", aa: cheapFast.aa });
    const withoutAa = profile("oc/plain");

    const { profiles } = attachAaScoresAndReasons([withAa, withoutAa]);

    expect(Object.keys(profiles[0].aaScores || {}).sort()).toEqual(["complex", "reasoning", "simple", "standard"]);
    expect(profiles[0].suggestionReason).toContain("AA intel 30");
    expect(profiles[1].aaScores).toBeUndefined();
    expect(profiles[1].suggestionReason).toBeUndefined();
  });
});
