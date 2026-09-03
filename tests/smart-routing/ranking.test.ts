import { describe, expect, it } from "vitest";
import {
  getSmartTierOrder,
  rankSmartProfiles,
  rankSmartProfilesForEndpoint,
  serviceKindForNeed,
} from "@/server/llm-gateway/engine/services/smart-routing/inventory";
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

function withKinds(modelKey: string, serviceKinds: string[], search = false): SmartModelProfile {
  const base = profile(modelKey, "standard");
  return { ...base, capabilities: { ...base.capabilities, serviceKinds, search } };
}

describe("endpoint service eligibility", () => {
  const searchOnly = withKinds("anysearch/anysearch", ["webSearch"]);
  const chatWithSearch = withKinds("perplexity/sonar", ["llm", "webSearch"], true);
  const chatOnly = withKinds("toll/gemini_3_pro", ["llm"]);
  const searchOverrides = {
    ...DEFAULT_SMART_ROUTING_CONFIG,
    overrides: { web_search: { default: ["anysearch/anysearch", "toll/gemini_3_pro", "perplexity/sonar"] } },
  };

  it("maps each endpoint to the service its answer must come from", () => {
    expect(serviceKindForNeed("general")).toBe("llm");
    expect(serviceKindForNeed("coding")).toBe("llm");
    expect(serviceKindForNeed("web_search")).toBe("webSearch");
    expect(serviceKindForNeed("tts")).toBe("tts");
    expect(serviceKindForNeed("embeddings")).toBe("embedding");
  });

  // A search-only provider answers /v1/search, never a chat turn: its payload is
  // a result list, so the chat would render raw links as the assistant reply.
  it("never offers a search-only provider to a chat request", () => {
    const result = rankSmartProfiles([searchOnly, chatWithSearch], "web_search", "standard", searchOverrides, 0, "llm");
    expect(result.map((candidate) => candidate.modelKey)).toEqual(["perplexity/sonar"]);
  });

  it("still offers a search-only provider to the search endpoint", () => {
    const result = rankSmartProfiles([searchOnly, chatOnly], "web_search", "standard", searchOverrides, 0, "webSearch");
    expect(result.map((candidate) => candidate.modelKey)).toEqual(["anysearch/anysearch"]);
  });

  it("prefers a chat model that can search when the request needs search", () => {
    const resolved = rankSmartProfilesForEndpoint({
      profiles: [searchOnly, chatWithSearch, chatOnly],
      need: "web_search",
      endpointNeed: "general",
      requestedTier: "standard",
      config: searchOverrides,
    });
    expect(resolved.need).toBe("web_search");
    expect(resolved.fellBackToEndpointNeed).toBe(false);
    expect(resolved.candidates.map((candidate) => candidate.modelKey)).toEqual(["perplexity/sonar"]);
  });

  // Answering with a plain chat model beats answering with a link dump or a 503.
  it("falls back to the endpoint need when no chat model covers the classified need", () => {
    const resolved = rankSmartProfilesForEndpoint({
      profiles: [searchOnly, chatOnly],
      need: "web_search",
      endpointNeed: "general",
      requestedTier: "standard",
      config: searchOverrides,
    });
    expect(resolved.need).toBe("general");
    expect(resolved.fellBackToEndpointNeed).toBe(true);
    expect(resolved.candidates.map((candidate) => candidate.modelKey)).toEqual(["toll/gemini_3_pro"]);
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

