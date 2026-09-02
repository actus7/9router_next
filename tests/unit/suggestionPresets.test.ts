import { describe, expect, it } from "vitest";
import type { SmartModelProfile } from "@/shared/llm-catalog";
import { capProfilesPerTier } from "@/app/(dashboard)/dashboard/combos/[id]/smartComboHelpers";

function profile(modelKey: string, quality: number, latencyScore: number): SmartModelProfile {
  return {
    modelKey, provider: "oc", model: modelKey.slice(3), displayName: modelKey,
    capabilities: { serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, tools: false, search: false, reasoning: false, contextWindow: 1, maxOutput: 1 },
    inputPrice: null, outputPrice: null, quality, latencyScore, reliabilityScore: 0.8,
    recommendedTier: "standard", needScores: {}, source: "deterministic", inventoryFingerprint: "test",
  };
}

describe("suggestion presets", () => {
  it("puts tested lower-latency models first in the performance preset", () => {
    const slowHighQuality = profile("oc/slow", 0.95, 0.9);
    const fastLowerQuality = profile("oc/fast", 0.7, 0.4);
    const result = capProfilesPerTier([slowHighQuality, fastLowerQuality], "performance", {
      "oc/slow": { latencyMs: 3000, testedAt: "2026-01-01T00:00:00.000Z" },
      "oc/fast": { latencyMs: 120, testedAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(result.find((item) => item.recommendedTier === "simple")?.modelKey).toBe("oc/fast");
  });

  it("puts the highest-quality model first in the quality preset", () => {
    const result = capProfilesPerTier([profile("oc/lower", 0.7, 0.9), profile("oc/better", 0.95, 0.1)], "quality");

    expect(result.find((item) => item.recommendedTier === "standard")?.modelKey).toBe("oc/better");
  });
});
