import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "@/server/llm-gateway/engine/providers/capabilities";
import { getPricingForModel } from "@/server/llm-gateway/engine/providers/pricing";
import opencodeGo from "@/server/llm-gateway/engine/providers/registry/opencode-go";

// opencode-go's catalogue is discovered (/zen/go/v1/models), so Kimi K3.1 Pro arrives from
// the listing. What the listing does not say: its price (the kimi-k3* wildcard priced it at
// K3 rates) and its endpoint, which is the chat-completions lane only.

describe("opencode-go Kimi K3.1 Pro", () => {
  it("is priced at its own rate, not the kimi-k3 wildcard", () => {
    expect(getPricingForModel("opencode-go", "kimi-k3.1-pro")).toMatchObject({
      input: 2,
      output: 10,
      cached: 0.2,
      cache_creation: 2,
    });
  });

  it("keeps the vision, video, always-on thinking and 1M context of K3", () => {
    expect(getCapabilitiesForModel("opencode-go", "kimi-k3.1-pro")).toMatchObject({
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 131072,
    });
  });

  it("is routed only on the chat-completions lane", () => {
    expect(opencodeGo.modelOverrides["kimi-k3.1-pro"]).toMatchObject({ supportedFormats: ["openai"] });
  });
});
