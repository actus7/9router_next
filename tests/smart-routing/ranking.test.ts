import { describe, expect, it } from "vitest";
import { getSmartTierOrder, rankSmartProfiles } from "@/server/llm-gateway/engine/services/smart-routing/inventory";
import { attachRoutingDecision, getRoutingDecision } from "@/server/llm-gateway/engine/services/smart-routing/context";
import { DEFAULT_SMART_ROUTING_CONFIG, type RoutingTier, type SmartModelProfile } from "@/server/llm-gateway/engine/services/smart-routing/types";

function profile(modelKey: string, tier: RoutingTier, options: Partial<SmartModelProfile> = {}): SmartModelProfile {
  const [provider, ...modelParts] = modelKey.split("/");
  return {
    modelKey,
    provider,
    model: modelParts.join("/"),
    displayName: modelKey,
    capabilities: {
      serviceKinds: ["llm"],
      vision: false,
      pdf: false,
      audioInput: false,
      videoInput: false,
      imageOutput: false,
      audioOutput: false,
      tools: true,
      search: false,
      reasoning: tier === "reasoning",
      contextWindow: 200_000,
      maxOutput: 32_000,
    },
    inputPrice: 1,
    outputPrice: 2,
    quality: tier === "simple" ? 0.5 : tier === "standard" ? 0.68 : 0.85,
    latencyScore: tier === "simple" ? 0.9 : 0.65,
    reliabilityScore: 0.8,
    recommendedTier: tier,
    needScores: { general: 0.8, coding: 0.8 },
    source: "deterministic",
    inventoryFingerprint: modelKey,
    ...options,
  };
}

describe("smart model ranking", () => {
  it("orders selected tier, higher tiers, then lower degraded tiers", () => {
    expect(getSmartTierOrder("standard")).toEqual(["standard", "complex", "reasoning", "simple"]);
    const result = rankSmartProfiles([
      profile("p/simple", "simple"),
      profile("p/standard", "standard"),
      profile("p/complex", "complex"),
      profile("p/reasoning", "reasoning"),
    ], "general", "standard", DEFAULT_SMART_ROUTING_CONFIG);
    expect(result.map((candidate) => candidate.modelKey)).toEqual(["p/standard", "p/complex", "p/reasoning", "p/simple"]);
    expect(result.at(-1)?.degraded).toBe(true);
  });

  it("filters hard capability mismatches", () => {
    const vision = profile("p/vision", "standard", { capabilities: { ...profile("p/base", "standard").capabilities, vision: true } });
    const text = profile("p/text", "standard");
    expect(rankSmartProfiles([text, vision], "vision", "standard", DEFAULT_SMART_ROUTING_CONFIG).map((candidate) => candidate.modelKey)).toEqual(["p/vision"]);
  });

  it("puts compatible manual overrides first", () => {
    const config = {
      ...DEFAULT_SMART_ROUTING_CONFIG,
      overrides: { coding: { standard: ["p/second"] } },
    };
    const result = rankSmartProfiles([profile("p/first", "standard"), profile("p/second", "standard")], "coding", "standard", config);
    expect(result[0]).toMatchObject({ modelKey: "p/second", source: "manual" });
  });
});

describe("routing metadata transport", () => {
  it("survives object spread without appearing in JSON", () => {
    const body = attachRoutingDecision({ model: "smart" }, {
      comboName: "smart",
      need: "general",
      tier: "standard",
      score: 0,
      confidence: 0.5,
      reason: "scored",
      degraded: false,
      tierOrder: ["standard", "complex", "reasoning", "simple"],
      candidates: ["p/model"],
      candidateDetails: [{ model: "p/model", tier: "standard", degraded: false, source: "deterministic" }],
      profileSources: ["deterministic"],
    });
    const spread = { ...body, model: "p/model" };
    expect(getRoutingDecision(spread)?.comboName).toBe("smart");
    expect(JSON.stringify(spread)).not.toContain("comboName");
  });
});

