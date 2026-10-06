import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/llm-gateway/engine/host/store", () => ({ getComboByName: vi.fn() }));
vi.mock("@/server/llm-gateway/engine/services/smart-routing/scoring", () => ({
  recordRoutingTier: vi.fn(),
  // Always below the classifier threshold, so the classifiers are consulted.
  scoreRoutingRequest: vi.fn(() => ({
    tier: "standard",
    need: "general",
    needConfidence: 0,
    confidence: 0.1,
    score: 0,
    reason: "scored",
    signals: { lastUserText: "prove that sqrt(2) is irrational", tokenEstimate: 10 },
  })),
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
import { DEFAULT_SMART_ROUTING_CONFIG } from "@/server/llm-gateway/engine/services/smart-routing/types";

const routingWith = (model: string) => ({
  ...DEFAULT_SMART_ROUTING_CONFIG,
  classifier: { ...DEFAULT_SMART_ROUTING_CONFIG.classifier, model },
});

const combo = { name: "smart", kind: "smart", models: [], routing: null };
const body = { messages: [{ role: "user", content: "prove that sqrt(2) is irrational" }] };

describe("smart routing with Jev", () => {
  const classifyWithModel = vi.fn();
  beforeEach(() => {
    classifyWithModel.mockReset();
    classifyWithModel.mockResolvedValue({ tier: "simple", need: "general" });
  });

  it("uses a confident Jev answer and skips the LLM classifier", async () => {
    const classifyWithJev = vi.fn(async () => ({ tier: "reasoning" as const, need: "coding" as const, confidence: 0.9, model: "typesafe-ai/jev" }));

    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev, classifyWithModel });

    expect(classifyWithJev).toHaveBeenCalledWith("prove that sqrt(2) is irrational", "general", 5000);
    expect(classifyWithModel).not.toHaveBeenCalled();
    expect(meta).toMatchObject({
      tier: "reasoning",
      need: "coding",
      reason: "jev_primary",
      classifierSource: "jev",
      classifierModel: "typesafe-ai/jev",
    });
  });

  it("hands an unsure Jev answer to the LLM classifier", async () => {
    const classifyWithJev = vi.fn(async () => ({ tier: "reasoning" as const, confidence: 0.2, model: "typesafe-ai/jev" }));

    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev, classifyWithModel });

    expect(classifyWithModel).toHaveBeenCalledOnce();
    expect(meta).toMatchObject({ tier: "simple", reason: "llm_classifier", classifierModel: "oc/cheap" });
  });

  it.each([
    ["returns null", vi.fn(async () => null)],
    ["throws", vi.fn(async () => { throw new Error("boom"); })],
  ])("falls through to the LLM classifier when Jev %s", async (_label, classifyWithJev) => {
    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev, classifyWithModel });
    expect(meta.reason).toBe("llm_classifier");
  });

  it("stays ambiguous when neither classifier answers", async () => {
    classifyWithModel.mockResolvedValue(null);
    const { meta } = await resolveSmartRouting({ combo, body, classifyWithJev: vi.fn(async () => null), classifyWithModel });
    expect(meta.reason).toBe("ambiguous");
  });
});

describe("smart routing with a System One tiebreaker model", () => {
  const classifyWithModel = vi.fn();
  const systemOneCombo = { name: "smart", kind: "smart", models: [], routing: routingWith("typesafe-ai/laya") };
  beforeEach(() => {
    classifyWithModel.mockReset();
    classifyWithModel.mockResolvedValue({ tier: "simple", need: "general" });
  });

  it("asks the chosen System One model explicitly, regardless of the decision-engine flags", async () => {
    const classifyWithJev = vi.fn(async () => ({ tier: "complex" as const, confidence: 0.9, model: "typesafe-ai/laya" }));
    const { meta } = await resolveSmartRouting({ combo: systemOneCombo, body, classifyWithJev, classifyWithModel });
    expect(classifyWithJev).toHaveBeenCalledWith("prove that sqrt(2) is irrational", "general", 5000, { model: "typesafe-ai/laya", explicit: true });
    expect(meta).toMatchObject({ tier: "complex", classifierModel: "typesafe-ai/laya", classifierSource: "jev" });
    expect(classifyWithModel).not.toHaveBeenCalled();
  });

  it("falls back to the automatic LLM tiebreaker — never sending the System One id as an LLM", async () => {
    const classifyWithJev = vi.fn(async () => null);
    const { meta } = await resolveSmartRouting({ combo: systemOneCombo, body, classifyWithJev, classifyWithModel });
    expect(classifyWithModel).toHaveBeenCalledOnce();
    expect(classifyWithModel.mock.calls[0][0]).toBe("oc/cheap");
    expect(meta.classifierModel).toBe("oc/cheap");
  });

  it("an LLM tiebreaker choice leaves the default Jev call untouched", async () => {
    const classifyWithJev = vi.fn(async () => null);
    const llmCombo = { ...systemOneCombo, routing: routingWith("oc/cheap") };
    await resolveSmartRouting({ combo: llmCombo, body, classifyWithJev, classifyWithModel });
    expect(classifyWithJev).toHaveBeenCalledWith("prove that sqrt(2) is irrational", "general", 5000);
  });
});
