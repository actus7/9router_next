import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Suggest routing, hybrid pass: one Jev call per batch answers the typed
 * categories (tier, dominant need) and the LLM keeps the numeric scores it
 * wrote. Only confident, well-formed choices overlay; everything else (low
 * confidence, null) leaves the LLM suggestion exactly as it was. Fail-open.
 */

const decideWithJev = vi.hoisted(() => vi.fn());
vi.mock("@/server/decisions/jev", () => ({ decideWithJev }));

import {
  jevSuggestionOverrides,
  overlayJevSuggestion,
} from "@/server/application/use-cases/smart-routing/suggestJev";

function choiceAnswer(choice: string, confidence: number) {
  return { type: "choice", choice, confidence, probabilities: {} };
}

const model = { modelKey: "oc/strong", description: "A large frontier model", pricing: { inputPrice: 10, outputPrice: 30 } };

beforeEach(() => {
  decideWithJev.mockReset();
});

describe("jevSuggestionOverrides", () => {
  it("a confident tier (0.8) overlays what the LLM suggested", async () => {
    decideWithJev.mockResolvedValue({
      answers: { tier_0: choiceAnswer("complex", 0.8), need_0: choiceAnswer("coding", 0.8) },
      source: "jev",
    });
    const overrides = await jevSuggestionOverrides([model]);
    expect(overrides.get("oc/strong")).toEqual({ tier: "complex", need: "coding" });

    const suggestion = overlayJevSuggestion(
      { recommendedTier: "simple", need: "general", needScores: { coding: 0.2, general: 0.8 } },
      overrides.get("oc/strong"),
    );
    expect(suggestion).toEqual({
      recommendedTier: "complex",
      need: "coding",
      // The LLM's numeric scores pass through untouched.
      needScores: { coding: 0.2, general: 0.8 },
    });
  });

  it("low confidence (0.6) yields no override and the LLM verdict stands", async () => {
    decideWithJev.mockResolvedValue({
      answers: { tier_0: choiceAnswer("complex", 0.6), need_0: choiceAnswer("coding", 0.6) },
      source: "jev",
    });
    const overrides = await jevSuggestionOverrides([model]);
    expect(overrides.size).toBe(0);

    const llm = { recommendedTier: "simple", need: "general" };
    expect(overlayJevSuggestion(llm, overrides.get("oc/strong"))).toEqual(llm);
  });

  it("a silent Jev changes nothing (current flow)", async () => {
    decideWithJev.mockResolvedValue(null);
    const overrides = await jevSuggestionOverrides([model]);
    expect(overrides.size).toBe(0);

    const llm = { recommendedTier: "standard", need: "general" };
    expect(overlayJevSuggestion(llm, overrides.get("oc/strong"))).toBe(llm);
  });

  it("one batch call asks tier/need for every model at once", async () => {
    const models = [
      model,
      { modelKey: "oc/cheap", description: "A tiny fast model" },
      { modelKey: "oc/plain" },
    ];
    decideWithJev.mockResolvedValue({ answers: {}, source: "jev" });
    await jevSuggestionOverrides(models);

    expect(decideWithJev).toHaveBeenCalledOnce();
    const [feature, state, questions, options] = decideWithJev.mock.calls[0] as [
      string,
      { models: Array<{ id: string; modelKey: string }> },
      Record<string, { type: string }>,
      { timeoutMs: number },
    ];
    expect(feature).toBe("suggestRouting");
    expect(options).toEqual({ timeoutMs: 10_000 });
    expect(state.models.map((entry) => entry.id)).toEqual(["m0", "m1", "m2"]);
    expect(Object.keys(questions)).toEqual([
      "tier_0", "need_0", "tier_1", "need_1", "tier_2", "need_2",
    ]);
    expect(questions.tier_0?.type).toBe("choice");
    expect(questions.need_0?.type).toBe("choice");
  });

  it("drops choices outside the criteria instead of overlaying them", async () => {
    decideWithJev.mockResolvedValue({
      answers: { tier_0: choiceAnswer("turbo", 0.9), need_0: choiceAnswer("coding", 0.9) },
      source: "jev",
    });
    const overrides = await jevSuggestionOverrides([model]);
    expect(overrides.get("oc/strong")).toEqual({ need: "coding" });
  });
});
