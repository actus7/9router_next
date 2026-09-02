import { describe, expect, it } from "vitest";
import { filterDiscoveredNoAuthModels, parseRemoteModels } from "@/app/api/models/free/route";
import { buildFreeChatModels, isFreeModelEnabledForChat } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useChatModels";

describe("free model discovery", () => {
  it("keeps every chat-capable model returned by a no-auth provider", () => {
    expect(parseRemoteModels({
      data: [
        { id: "big-pickle" },
        { id: "mimo-v2.5-free", name: "MiMo" },
        { id: "ling-3.0-flash-fin-free" },
        { id: "audio-transcribe" },
      ],
    })).toEqual([
      { id: "big-pickle", name: "big-pickle" },
      { id: "mimo-v2.5-free", name: "MiMo" },
      { id: "ling-3.0-flash-fin-free", name: "ling-3.0-flash-fin-free" },
    ]);
  });

  it("keeps active free models while respecting models disabled in the provider screen", () => {
    const disabled = { oc: ["deepseek-v4-flash-free", "muse-spark-1.2-contributor-free", "nemotron-3-ultra-free"] };
    expect(isFreeModelEnabledForChat("opencode", "oc/mimo-v2.5-free", disabled)).toBe(true);
    expect(isFreeModelEnabledForChat("opencode", "oc/deepseek-v4-flash-free", disabled)).toBe(false);
  });

  it("filters OpenCode's free catalogue before applying the discovery limit", () => {
    const discovered = [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `paid-model-${index}`, name: "Paid model" })),
      { id: "big-pickle", name: "big-pickle" },
      { id: "deepseek-v4-flash-free", name: "deepseek-v4-flash-free" },
      { id: "muse-spark-1.2-contributor-free", name: "muse-spark-1.2-contributor-free" },
      { id: "mimo-v2.5-free", name: "MiMo V2.5 Free" },
      { id: "ling-3.0-flash-fin-free", name: "ling-3.0-flash-fin-free" },
      { id: "nemotron-3-ultra-free", name: "nemotron-3-ultra-free" },
      { id: "nemotron-3.5-lightning-free", name: "nemotron-3.5-lightning-free" },
      { id: "laguna-s-2.1-free", name: "laguna-s-2.1-free" },
    ];
    const disabled = { oc: ["deepseek-v4-flash-free", "muse-spark-1.2-contributor-free", "nemotron-3-ultra-free"] };

    const availableInChat = filterDiscoveredNoAuthModels(discovered, "opencode-free")
      .filter((model) => isFreeModelEnabledForChat("opencode", `oc/${model.id}`, disabled))
      .map((model) => model.id);

    expect(availableInChat).toEqual([
      "big-pickle",
      "mimo-v2.5-free",
      "ling-3.0-flash-fin-free",
      "nemotron-3.5-lightning-free",
      "laguna-s-2.1-free",
    ]);
  });

  it("keeps models discovered in the provider screen available in chat", () => {
    const models = buildFreeChatModels(
      "opencode",
      [{ id: "oc/mimo-v2.5-free", name: "MiMo" }],
      [
        { providerAlias: "oc", id: "big-pickle", name: "Big Pickle", source: "discovered" },
        { providerAlias: "oc", id: "mimo-v2.5-free", name: "MiMo", source: "discovered" },
        { providerAlias: "oc", id: "ling-3.0-flash-fin-free", name: "Ling", source: "discovered" },
        { providerAlias: "oc", id: "deepseek-v4-flash-free", name: "DeepSeek", source: "discovered" },
      ],
      { oc: ["deepseek-v4-flash-free"] },
    );

    expect(models.map((model) => model.id)).toEqual([
      "oc/mimo-v2.5-free",
      "oc/big-pickle",
      "oc/ling-3.0-flash-fin-free",
    ]);
  });
});
