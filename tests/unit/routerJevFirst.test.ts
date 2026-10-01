import { beforeEach, describe, expect, it, vi } from "vitest";

// Jev-first smart routing: a confident Jev answer decides outright, the
// heuristic score is the fallback, and the LLM classifier only runs when both
// are unsure. The `x-router-tier` header still overrides everything last.

const scoreRoutingRequest = vi.hoisted(() => vi.fn());

vi.mock("@/server/llm-gateway/engine/host/store", () => ({ getComboByName: vi.fn() }));
vi.mock("@/server/llm-gateway/engine/services/smart-routing/scoring", () => ({
  recordRoutingTier: vi.fn(),
  scoreRoutingRequest,
}));
vi.mock("@/server/llm-gateway/engine/services/smart-routing/inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/llm-gateway/engine/services/smart-routing/inventory")>()),
  refreshDeterministicSmartProfiles: vi.fn(async () => [
    { modelKey: "oc/cheap", capabilities: { serviceKinds: ["llm"] }, quality: 0.5, reliabilityScore: 0.5, latencyScore: 0.5 },
  ]),
  rankSmartProfilesForEndpoint: vi.fn(({ need }) => ({
    candidates: [{ modelKey: "oc/cheap", tier: "standard", degraded: false, source: "deterministic" }],
    need,
    fellBackToEndpointNeed: false,
  })),
}));

import { resolveSmartRouting } from "@/server/llm-gateway/engine/services/smart-routing/router";

const combo = { name: "smart", kind: "smart", models: [], routing: null };
const body = { messages: [{ role: "user", content: "prove that sqrt(2) is irrational" }] };
const TEXT = "prove that sqrt(2) is irrational";

function heuristic(confidence: number, tier: "simple" | "standard" | "complex" | "reasoning" = "complex") {
  return {
    tier,
    need: "coding",
    needConfidence: 1,
    confidence,
    score: 5,
    reason: "scored",
    signals: { lastUserText: TEXT, tokenEstimate: 10 },
  };
}

describe("Jev-first smart routing", () => {
  const classifyWithModel = vi.fn();
  beforeEach(() => {
    classifyWithModel.mockReset();
    classifyWithModel.mockResolvedValue({ tier: "simple", need: "general" });
    scoreRoutingRequest.mockReset();
  });

  it("lets a confident Jev answer decide over a strong heuristic", async () => {
    scoreRoutingRequest.mockReturnValue(heuristic(0.9));
    const classifyWithJev = vi.fn(async () => ({ tier: "reasoning" as const, need: "coding" as const, confidence: 0.9, model: "typesafe-ai/jev" }));

    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev, classifyWithModel });

    expect(classifyWithJev).toHaveBeenCalledWith(TEXT, "general", 5000);
    expect(classifyWithModel).not.toHaveBeenCalled();
    expect(meta).toMatchObject({
      tier: "reasoning",
      need: "coding",
      reason: "jev_primary",
      classifierSource: "jev",
      classifierModel: "typesafe-ai/jev",
    });
  });

  it("falls back to the heuristic when Jev is unsure but the score is confident", async () => {
    scoreRoutingRequest.mockReturnValue(heuristic(0.9));
    const classifyWithJev = vi.fn(async () => ({ tier: "reasoning" as const, confidence: 0.2, model: "typesafe-ai/jev" }));

    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev, classifyWithModel });

    expect(meta).toMatchObject({ tier: "complex", reason: "scored", classifierSource: "heuristic" });
    expect(classifyWithModel).not.toHaveBeenCalled();
  });

  it("falls back to the heuristic when Jev answers null", async () => {
    scoreRoutingRequest.mockReturnValue(heuristic(0.9));
    const classifyWithJev = vi.fn(async () => null);

    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev, classifyWithModel });

    expect(meta).toMatchObject({ tier: "complex", reason: "scored", classifierSource: "heuristic" });
    expect(classifyWithModel).not.toHaveBeenCalled();
  });

  it("asks the LLM classifier only when Jev and the heuristic are both unsure", async () => {
    scoreRoutingRequest.mockReturnValue(heuristic(0.1));
    const classifyWithJev = vi.fn(async () => ({ tier: "reasoning" as const, confidence: 0.2, model: "typesafe-ai/jev" }));

    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev, classifyWithModel });

    expect(classifyWithModel).toHaveBeenCalledOnce();
    expect(meta).toMatchObject({ tier: "simple", reason: "llm_classifier", classifierSource: "llm" });
  });

  it("stays ambiguous when neither Jev, the heuristic nor the LLM classifier answers", async () => {
    scoreRoutingRequest.mockReturnValue(heuristic(0.1));
    classifyWithModel.mockResolvedValue(null);

    const { meta } = await resolveSmartRouting({
      combo,
      body,
      classifyWithJev: vi.fn(async () => null),
      classifyWithModel,
    });

    expect(meta).toMatchObject({ reason: "ambiguous", classifierSource: "heuristic" });
  });

  it("keeps the x-router-tier header as the final word", async () => {
    scoreRoutingRequest.mockReturnValue(heuristic(0.9));
    const classifyWithJev = vi.fn(async () => ({ tier: "reasoning" as const, confidence: 0.95, model: "typesafe-ai/jev" }));

    const { meta } = await resolveSmartRouting({
      combo,
      body,
      headers: { "x-router-tier": "simple" },
      classifyWithJev,
      classifyWithModel,
    });

    expect(meta).toMatchObject({ tier: "simple", reason: "header_override" });
    expect(classifyWithModel).not.toHaveBeenCalled();
  });
});
