import { describe, expect, it } from "vitest";
import type { RoutingTier, SmartModelProfile } from "@/shared/llm-catalog";
import { MAX_SUGGESTIONS_PER_TIER, suggestionLanes } from "@/app/(dashboard)/dashboard/combos/[id]/smartComboHelpers";

/**
 * The board side of the suggestion: lanes are filled from the server's
 * per-lane scores, ordered by the chosen preset, with a cap on how many copies
 * of one model (several providers) a lane may hold.
 */

function profile(
  modelKey: string,
  laneScores: Partial<Record<RoutingTier, number>>,
  laneQuality: Partial<Record<RoutingTier, number>> = laneScores,
  canonicalKey = modelKey,
): SmartModelProfile {
  return {
    modelKey, provider: modelKey.includes("/") ? modelKey.split("/")[0] : "oc", model: modelKey, displayName: modelKey,
    capabilities: { serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, tools: false, search: false, reasoning: false, contextWindow: 1, maxOutput: 1 },
    inputPrice: null, outputPrice: null, quality: 0.5, latencyScore: 0.5, reliabilityScore: 0.8,
    recommendedTier: "standard", needScores: {}, source: "deterministic", inventoryFingerprint: "test",
    laneScores, laneQuality, canonicalKey, scoreSource: "measured",
  };
}

const keys = (items: SmartModelProfile[]) => items.map((item) => item.modelKey);

describe("suggestionLanes", () => {
  it("puts a model in every lane it is eligible for, and nowhere else", () => {
    const lanes = suggestionLanes([profile("a", { standard: 0.7, complex: 0.8 }), profile("b", { simple: 0.9 })]);
    expect(keys(lanes.standard)).toEqual(["a"]);
    expect(keys(lanes.complex)).toEqual(["a"]);
    expect(keys(lanes.simple)).toEqual(["b"]);
    expect(lanes.reasoning).toEqual([]);
  });

  it("orders Balanced by the lane score and Highest quality by quality alone", () => {
    const cheap = profile("cheap", { reasoning: 0.84 }, { reasoning: 0.9 });
    const best = profile("best", { reasoning: 0.71 }, { reasoning: 1 });
    expect(keys(suggestionLanes([best, cheap], "balanced").reasoning)).toEqual(["cheap", "best"]);
    expect(keys(suggestionLanes([cheap, best], "quality").reasoning)).toEqual(["best", "cheap"]);
  });

  it("puts tested lower-latency models first in the performance preset", () => {
    const lanes = suggestionLanes([profile("slow", { simple: 0.9 }), profile("fast", { simple: 0.4 })], "performance", {
      slow: { latencyMs: 3000, testedAt: "2026-01-01T00:00:00.000Z" },
      fast: { latencyMs: 120, testedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(keys(lanes.simple)).toEqual(["fast", "slow"]);
  });

  it("keeps at most two copies of one model per lane", () => {
    const copies = ["p1", "p2", "p3", "p4"].map((provider, index) => profile(`${provider}/mimo`, { complex: 0.9 - index * 0.01 }, undefined, "mimov26pro"));
    const lanes = suggestionLanes([...copies, profile("other", { complex: 0.5 })]);
    expect(keys(lanes.complex)).toEqual(["p1/mimo", "p2/mimo", "other"]);
  });

  it("caps each lane", () => {
    const many = Array.from({ length: MAX_SUGGESTIONS_PER_TIER + 5 }, (_, index) => profile(`p${index}/m${index}`, { standard: index / 100 }));
    expect(suggestionLanes(many).standard).toHaveLength(MAX_SUGGESTIONS_PER_TIER);
  });
});

describe("suggestionLanes provider spread", () => {
  // When one provider's credits run out, every model of it fails in turn
  // (402 locks only the model that failed). The lane must reach another
  // provider on the very next attempt.
  const lane = [
    profile("kg/glm", { complex: 0.95 }),
    profile("kg/mimo", { complex: 0.94 }),
    profile("kg/qwen", { complex: 0.93 }),
    profile("kg/opus", { complex: 0.92 }),
    profile("zai/glm", { complex: 0.8 }),
    profile("oa/sol", { complex: 0.7 }),
  ];

  it("never puts two models of one provider back to back while another provider is available", () => {
    const providers = suggestionLanes(lane).complex.map((item) => item.provider);
    for (let index = 1; index < providers.length; index += 1) {
      expect(providers[index], `position ${index}`).not.toBe(providers[index - 1]);
    }
  });

  it("keeps at most two models of one provider in a lane, best ones first", () => {
    expect(keys(suggestionLanes(lane).complex)).toEqual(["kg/glm", "zai/glm", "kg/mimo", "oa/sol"]);
  });

  it("still fills the lane from a single provider when that is all there is", () => {
    const single = [profile("kg/a", { simple: 0.9 }), profile("kg/b", { simple: 0.8 })];
    expect(keys(suggestionLanes(single).simple)).toEqual(["kg/a", "kg/b"]);
  });
});
