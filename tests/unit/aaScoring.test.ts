import { describe, expect, it } from "vitest";

/**
 * AA primitives: the per-tier weights, the per-tier quality mix and the
 * reason line. Lane assignment over these is covered by laneAssignment.test.
 */

import {
  AA_TIER_WEIGHTS,
  aaTierQuality,
  buildAaSuggestionReason,
} from "@/server/llm-gateway/engine/services/smart-routing/aaScoring";
import { ROUTING_TIERS } from "@/server/llm-gateway/engine/services/smart-routing/types";
import type { AaModelMetrics, SmartModelProfile } from "@/server/llm-gateway/engine/services/smart-routing/types";

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

describe("AA_TIER_WEIGHTS", () => {
  it("sums to 1 for every tier", () => {
    for (const tier of ROUTING_TIERS) {
      const weights = AA_TIER_WEIGHTS[tier];
      const sum = weights.quality + weights.speed + weights.cost + weights.latency;
      expect(sum, tier).toBeCloseTo(1, 10);
    }
  });
});

describe("aaTierQuality", () => {
  it("mixes coding and agentic into the upper lanes and renormalizes over what exists", () => {
    const full = aaMetrics({ intelligence: 50, coding: 80, agentic: 40 });
    expect(aaTierQuality(full, "standard")).toBe(50);
    expect(aaTierQuality(full, "complex")).toBeCloseTo(0.5 * 50 + 0.3 * 80 + 0.2 * 40, 10);
    // Only intelligence published: every lane falls back to it.
    expect(aaTierQuality(aaMetrics({ intelligence: 46 }), "complex")).toBe(46);
  });

  it("is null without AA metrics or without any index", () => {
    expect(aaTierQuality(undefined, "simple")).toBeNull();
    expect(aaTierQuality(aaMetrics(), "reasoning")).toBeNull();
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

    const reason = buildAaSuggestionReason(rich);

    expect(reason).toContain("AA intel 63");
    expect(reason).toContain("code 56");
    expect(reason).toContain("agentic 48");
    expect(reason).toContain("154 tok/s");
    expect(reason).toContain("TTFT 0.9s");
    expect(reason).toContain("$0.86/1M blended (3:1)");
  });

  it("returns undefined without AA metrics", () => {
    expect(buildAaSuggestionReason(profile("oc/plain"))).toBeUndefined();
    expect(buildAaSuggestionReason(profile("oc/no-metrics", { aa: aaMetrics() }))).toBeUndefined();
  });
});
