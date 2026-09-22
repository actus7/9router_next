import { describe, expect, it, vi } from "vitest";

import { getCapabilitiesForModel } from "@/server/llm-gateway/engine/providers/capabilities";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { __test__ as inventoryInternals } from "@/server/llm-gateway/engine/services/smart-routing/inventory";

// A chat asked for an image; the combo's first working model was Quillbot, a
// web session that forwards only the message text. It answered in prose
// ("sign in to generate images") and `generate_image` was never called.
// `features.toolCalling: false` is how the registry says a provider drops
// `tools`, and everything that routes tool requests has to honour it.

describe("providers that drop tools", () => {
  it.each(["quillbot", "duckai", "da"])("report tools: false under %s, whatever the model's name implies", (provider) => {
    expect(getCapabilitiesForModel(provider, "claude-haiku-4-5").tools).toBe(false);
  });

  it("leaves a provider that forwards tools alone", () => {
    expect(getCapabilitiesForModel("kgw", "claude-haiku-4-5").tools).toBe(true);
  });
});

describe("combo order for a request with tools", () => {
  const tools = [{ type: "function", function: { name: "generate_image", parameters: { type: "object" } } }];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  async function firstTried(body: Record<string, unknown>) {
    const tried: string[] = [];
    await handleComboChat({
      body,
      models: ["quillbot/quillbot-ai", "da/claude-haiku-4-5", "kgw/kilo-auto/free"],
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return new Response("{}", { status: 200 });
      },
      log,
      comboName: `combo-${Math.random()}`,
    });
    return tried[0];
  }

  it("tries a model that can call tools before those that cannot", async () => {
    expect(await firstTried({ messages: [{ role: "user", content: "draw a cat" }], tools })).toBe("kgw/kilo-auto/free");
  });

  it("keeps the configured order when the request has no tools", async () => {
    expect(await firstTried({ messages: [{ role: "user", content: "hi" }] })).toBe("quillbot/quillbot-ai");
  });
});

// Every Vercel AI Gateway chat model used to inherit the provider's "image"
// kind, so a smart combo asked for an image tried chat models first (81s).
describe("inventory service kinds", () => {
  const vercelKinds = ["llm", "embedding", "image", "imageToText", "webSearch"];

  it("keeps a typed model to its own kind", () => {
    expect(inventoryInternals.normalizeKinds(vercelKinds, "llm")).toEqual(["llm"]);
    expect(inventoryInternals.normalizeKinds(vercelKinds, "image")).toEqual(["image"]);
  });

  it("lets an untyped model inherit the provider's kinds, as before", () => {
    expect(inventoryInternals.normalizeKinds(vercelKinds, undefined)).toEqual(vercelKinds);
    expect(inventoryInternals.normalizeKinds(undefined, undefined)).toEqual(["llm"]);
  });

  it("keeps a vision-to-text model routable as chat", () => {
    expect(inventoryInternals.normalizeKinds(vercelKinds, "imageToText")).toEqual(["imageToText", "llm"]);
  });
});
