import { describe, expect, it } from "vitest";
import {
  COMBO_PROVIDER_ID,
  parseComboGroups,
  toComboProviderGroup,
} from "@/app/(dashboard)/dashboard/basic-chat/comboModels";

describe("chat combo models", () => {
  it("exposes an LLM combo as a bare-name request model", () => {
    const group = toComboProviderGroup([
      {
        name: "chat",
        kind: null,
        models: ["openai/gpt-5.5", "anthropic/claude-opus-4-6"],
      },
    ]);

    expect(group?.providerId).toBe(COMBO_PROVIDER_ID);
    expect(group?.connections).toEqual([]);
    expect(group?.models).toEqual([
      {
        id: "chat",
        requestModel: "chat",
        name: "chat",
        providerId: COMBO_PROVIDER_ID,
        providerName: "ModelHub",
        source: "combo",
      },
    ]);
  });

  it("keeps a smart combo even without an explicit model list", () => {
    const group = toComboProviderGroup([
      { name: "auto", kind: "smart", models: [] },
    ]);

    expect(group?.models.map((model) => model.id)).toEqual(["auto"]);
    expect(group?.models[0]?.kind).toBe("smart");
  });

  it("drops combos the chat endpoint cannot route", () => {
    const group = toComboProviderGroup([
      { name: "chat", models: ["openai/gpt-5.5"] },
      { name: "empty", models: [] },
      { name: "search", kind: "webSearch", models: ["tavily"] },
      { name: "art", kind: "image", models: ["openai/gpt-image-1"] },
      { name: "voice", kind: "tts", models: ["openai/tts-1"] },
      { name: "with/slash", models: ["openai/gpt-5.5"] },
      { name: "   ", models: ["openai/gpt-5.5"] },
    ]);

    expect(group?.models.map((model) => model.id)).toEqual(["chat"]);
  });

  it("returns no group when there is nothing routable", () => {
    expect(toComboProviderGroup([])).toBeNull();
    expect(parseComboGroups({})).toEqual([]);
    expect(
      parseComboGroups({
        combos: [{ name: "search", kind: "webFetch", models: ["exa"] }],
      }),
    ).toEqual([]);
    expect(
      parseComboGroups({
        combos: [{ name: "chat", models: ["openai/gpt-5.5"] }],
      }),
    ).toHaveLength(1);
  });
});
