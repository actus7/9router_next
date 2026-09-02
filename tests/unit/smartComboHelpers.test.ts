import { describe, expect, it } from "vitest";
import { capProfilesPerTier } from "@/app/(dashboard)/dashboard/combos/[id]/smartComboHelpers";
import type { SmartModelProfile } from "@/shared/llm-catalog";

function profile(modelKey: string, recommendedTier: SmartModelProfile["recommendedTier"], quality: number): SmartModelProfile {
  return {
    modelKey,
    provider: "test",
    model: modelKey,
    displayName: modelKey,
    capabilities: { serviceKinds: ["llm"], tools: true, vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, search: false, reasoning: false, contextWindow: 0, maxOutput: 0 },
    inputPrice: null,
    outputPrice: null,
    quality,
    latencyScore: 0.7,
    reliabilityScore: 0.72,
    recommendedTier,
    needScores: { general: 0.7 },
    source: "llm",
    inventoryFingerprint: modelKey,
    sources: [],
  };
}

describe("smart routing suggestion coverage", () => {
  it("keeps every complexity tier populated when the classifier skips complex", () => {
    const result = capProfilesPerTier([
      profile("simple", "simple", 0.4),
      profile("standard", "standard", 0.62),
      profile("standard-2", "standard", 0.7),
      profile("reasoning", "reasoning", 0.92),
    ]);

    expect(result.map((item) => item.recommendedTier)).toEqual([
      "simple", "standard", "complex", "reasoning",
    ]);
    expect(result.find((item) => item.recommendedTier === "complex")?.modelKey).toBe("standard-2");
  });
});
