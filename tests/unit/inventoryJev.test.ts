import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Jev over the model inventory: the cold-path tier judge. A confident answer
 * lands in `recommendedTier` exactly where the name regex used to; anything
 * else (low confidence, null) keeps the regex tier. Fail-open everywhere.
 */

const decideWithJev = vi.hoisted(() => vi.fn());
vi.mock("@/server/decisions/jev", () => ({ decideWithJev }));

vi.mock("@/server/llm-gateway/engine/host/store", () => ({
  getProviderConnections: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => [{ providerAlias: "oc", id: "m1", name: "Model One" }]),
  getSmartModelProfiles: vi.fn(async () => []),
  upsertSmartModelProfiles: vi.fn(async () => {}),
  getDisabledModels: vi.fn(async () => ({})),
  getPricingOverrides: vi.fn(async () => ({})),
}));
vi.mock("@/server/llm-gateway/engine/config/providerModels", () => ({
  getModelsByProviderId: vi.fn(() => []),
}));
vi.mock("@/server/llm-gateway/engine/providers/capabilities", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));
vi.mock("@/server/llm-gateway/engine/providers/pricing", () => ({
  getPricingForModel: vi.fn(() => null),
}));

import {
  invalidateSmartProfileCache,
  jevModelTiers,
  refreshDeterministicSmartProfiles,
} from "@/server/llm-gateway/engine/services/smart-routing/inventory";

/** Answers each model's `m<i>` question from its modelKey, skipping the rest. */
function jevTierAnswers(pick: (modelKey: string) => { choice: string; confidence: number } | null) {
  return async (_feature: unknown, state: unknown, questions: Record<string, unknown>) => {
    const models = (state as { models: Array<{ id: string; modelKey: string }> }).models;
    const answers: Record<string, unknown> = {};
    for (const model of models) {
      const verdict = pick(model.modelKey);
      if (verdict && questions[model.id]) {
        answers[model.id] = { type: "choice", choice: verdict.choice, confidence: verdict.confidence, probabilities: {} };
      }
    }
    return Object.keys(answers).length > 0 ? { answers, source: "jev" } : null;
  };
}

const models = [
  { modelKey: "oc/strong", description: "A large frontier model", pricing: { inputPrice: 10, outputPrice: 30 } },
  { modelKey: "oc/cheap", description: "A tiny fast model", pricing: { inputPrice: 0.1, outputPrice: 0.2 } },
];

beforeEach(() => {
  decideWithJev.mockReset();
  invalidateSmartProfileCache();
});

describe("jevModelTiers", () => {
  it("keeps only confident choices (>= 0.7); the rest stay with the regex", async () => {
    decideWithJev.mockImplementation(
      jevTierAnswers((modelKey) =>
        modelKey === "oc/strong" ? { choice: "complex", confidence: 0.8 } : { choice: "reasoning", confidence: 0.5 },
      ),
    );
    const tiers = await jevModelTiers(models);
    expect(tiers.get("oc/strong")).toEqual({ tier: "complex", confidence: 0.8 });
    expect(tiers.has("oc/cheap")).toBe(false);
  });

  it("returns an empty map when Jev answers nothing", async () => {
    decideWithJev.mockResolvedValue(null);
    expect((await jevModelTiers(models)).size).toBe(0);
    expect(decideWithJev).toHaveBeenCalledWith(
      "inventory",
      expect.objectContaining({ models: expect.any(Array) }),
      expect.objectContaining({ m0: expect.objectContaining({ type: "choice" }) }),
      { timeoutMs: 30_000 },
    );
  });

  it("asks with a valid state even when a model has no description", async () => {
    decideWithJev.mockImplementation(jevTierAnswers(() => ({ choice: "simple", confidence: 0.9 })));
    const tiers = await jevModelTiers([{ modelKey: "oc/plain" }]);
    expect(tiers.get("oc/plain")).toEqual({ tier: "simple", confidence: 0.9 });
    const [, state, questions] = decideWithJev.mock.calls[0] as [string, { models: Array<Record<string, unknown>> }, Record<string, unknown>];
    expect(state.models[0]).toEqual({ id: "m0", modelKey: "oc/plain" });
    expect(questions.m0).toMatchObject({ type: "choice" });
  });
});

describe("inventory profiles", () => {
  it("a confident Jev tier lands in recommendedTier and survives the cache", async () => {
    decideWithJev.mockImplementation(
      jevTierAnswers((modelKey) => (modelKey === "oc/m1" ? { choice: "complex", confidence: 0.8 } : null)),
    );
    const profiles = await refreshDeterministicSmartProfiles();
    const target = profiles.find((profile) => profile.modelKey === "oc/m1");
    // The regex would say "standard" for a plain small-ish name.
    expect(target?.recommendedTier).toBe("complex");

    const cached = await refreshDeterministicSmartProfiles();
    expect(cached.find((profile) => profile.modelKey === "oc/m1")?.recommendedTier).toBe("complex");
    expect(decideWithJev).toHaveBeenCalledTimes(1);
  });

  it("low confidence or a silent Jev keeps the regex tier", async () => {
    decideWithJev.mockImplementation(
      jevTierAnswers((modelKey) => (modelKey === "oc/m1" ? { choice: "reasoning", confidence: 0.5 } : null)),
    );
    expect((await refreshDeterministicSmartProfiles()).find((p) => p.modelKey === "oc/m1")?.recommendedTier).toBe("standard");

    invalidateSmartProfileCache();
    decideWithJev.mockResolvedValue(null);
    expect((await refreshDeterministicSmartProfiles()).find((p) => p.modelKey === "oc/m1")?.recommendedTier).toBe("standard");
  });
});
