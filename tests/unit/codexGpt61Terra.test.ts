import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "@/server/llm-gateway/engine/providers/capabilities";
import { getPricingForModel } from "@/server/llm-gateway/engine/providers/pricing";

// codex's catalogue is discovered, so gpt-6.1-terra arrives from the listing. It still needs
// its own capability row (Codex caps the window at 500k) and its own price.

describe("codex GPT-6.1 Terra", () => {
  it("has its Codex window and reasoning capabilities", () => {
    expect(getCapabilitiesForModel("codex", "gpt-6.1-terra")).toMatchObject({
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 500000,
      maxOutput: 128000,
    });
  });

  it("is priced at its own rate", () => {
    expect(getPricingForModel("codex", "gpt-6.1-terra")).toMatchObject({
      input: 1,
      cached: 0.05,
      cache_creation: 1.25,
      output: 5,
    });
  });
});
