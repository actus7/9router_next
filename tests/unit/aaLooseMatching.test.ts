import { describe, expect, it } from "vitest";
import { looseModelName, matchAaToProfile } from "@/server/application/use-cases/smart-routing/artificialAnalysis";
import type { SmartModelProfile } from "@/server/llm-gateway/smart-routing";

/**
 * Catalog decoration ("-free", "-review", "openrouter_" …) must not hide a model
 * AA does measure — and a different model must never collapse into a neighbour.
 */
const aa = (name: string) => ({ name }) as never;
const table = {
  mimov25: aa("MiMo-V2.5"),
  gpt56sol: aa("GPT-5.6 Sol"),
  o4minihigh: aa("o4-mini (High)"),
  o4mini: aa("o4-mini"),
  gpt4o: aa("GPT-4o"),
  gemma431b: aa("Gemma 4 31B"),
  gemini37flash: aa("Gemini 3.7 Flash"),
  gptoss120b: aa("gpt-oss-120b"),
  glm53flash: aa("GLM-5.3 Flash"),
  claudeopus45: aa("Claude Opus 4.5"),
} as Record<string, never>;
const profile = (model: string) => ({ model, displayName: model, recommendedTier: "simple" }) as unknown as SmartModelProfile;

describe("looseModelName", () => {
  it.each([
    ["mimo-v2.5-free", "mimo-v2.5"],
    ["GPT_o4_mini", "o4-mini"],
    ["openrouter_gpt_4_o", "gpt-4-o"],
    ["gemma-4-31b-it", "gemma-4-31b"],
    ["gpt-5.6-sol-review", "gpt-5.6-sol"],
    ["gemini-3.7-flash-tiered", "gemini-3.7-flash"],
  ])("%s → %s", (input, expected) => expect(looseModelName(input)).toBe(expected));

  it("keeps an 'it' that is not a trailing suffix", () => expect(looseModelName("it-model-7b")).toBe("it-model-7b"));
});

describe("matchAaToProfile with catalog decoration", () => {
  it.each([
    ["mimo-v2.5-free", "mimov25"],
    ["gpt-5.6-sol-review", "gpt56sol"],
    ["GPT_o4_mini", "o4mini"],
    ["openrouter_gpt_4_o", "gpt4o"],
    ["gemma-4-31b-it", "gemma431b"],
    ["gemini-3.7-flash-tiered", "gemini37flash"],
    ["gpt-oss-120b-medium", "gptoss120b"],
  ])("%s finds %s", (model, key) => expect(matchAaToProfile(profile(model), table)).toBe(table[key]));

  it.each(["glm-5.3-flashx", "claude_opus_4", "claude-haiku-4-5"])("does not stretch %s onto a different model", (model) => {
    expect(matchAaToProfile(profile(model), table)).toBeUndefined();
  });
});
