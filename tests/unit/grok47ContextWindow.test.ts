import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "@/server/llm-gateway/engine/providers/capabilities";

// Grok 4.7 has a 500k window like 4.6. Without its own row it fell to `*grok-4*` (256k),
// and a combo reports its smallest member window.

const caps = (id: string, provider: string) => getCapabilitiesForModel(provider, id);

describe("Grok 4.7 context window", () => {
  it.each(["xai", "grok-cli", "opencode-go", "tokenharbor"])("advertises 500k via %s", (provider) => {
    expect(caps("grok-4.7", provider).contextWindow).toBe(500000);
  });

  it("keeps the Grok 4 feature set: vision, reasoning, search and tools", () => {
    expect(caps("grok-4.7", "grok-cli")).toMatchObject({
      vision: true,
      reasoning: true,
      search: true,
      tools: true,
      thinkingFormat: "openai",
      maxOutput: 500000,
    });
  });

  it("matches variant ids too", () => {
    expect(caps("grok-4.7-build-fast", "grok-cli").contextWindow).toBe(500000);
  });

  it("leaves the grok-4 catch-all alone", () => {
    expect(caps("grok-4", "xai").contextWindow).toBe(256000);
  });
});
