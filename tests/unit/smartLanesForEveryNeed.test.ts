import { describe, expect, it } from "vitest";
import { rankSmartProfiles } from "@/server/llm-gateway/engine/services/smart-routing/inventory";
import { DEFAULT_SMART_ROUTING_CONFIG, type SmartModelProfile, type SmartRoutingConfig } from "@/server/llm-gateway/engine/services/smart-routing/types";

function profile(modelKey: string, tools = true): SmartModelProfile {
  return {
    modelKey,
    provider: modelKey.split("/")[0],
    model: modelKey.split("/").slice(1).join("/"),
    displayName: modelKey,
    capabilities: { serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, tools, search: false, reasoning: false, contextWindow: 1_000_000, maxOutput: 1 },
    inputPrice: null,
    outputPrice: null,
    quality: 0.6,
    latencyScore: 0.7,
    reliabilityScore: 0.8,
    recommendedTier: "standard",
    needScores: {},
    source: "deterministic",
    inventoryFingerprint: "test",
  };
}

// The four columns of the combo screen are stored under `general`; the
// "always considered" list rides every need as `default` (mergeLegacyModels).
const config: SmartRoutingConfig = {
  ...DEFAULT_SMART_ROUTING_CONFIG,
  overrides: {
    general: { complex: ["cx/sol", "glm/glm-5.3", "no-tools/x"] },
    tool_use: { default: ["alitp/deepseek-flash", "xmtp/mimo-pro"] },
  },
};
const profiles = ["cx/sol", "glm/glm-5.3", "alitp/deepseek-flash", "xmtp/mimo-pro"].map((k) => profile(k)).concat(profile("no-tools/x", false));

describe("smart lanes apply to every need", () => {
  it("puts the tier's column first for a tool request, before the always-considered list", () => {
    const ranked = rankSmartProfiles(profiles, "tool_use", "complex", config).map((c) => c.modelKey);
    expect(ranked.slice(0, 4)).toEqual(["cx/sol", "glm/glm-5.3", "alitp/deepseek-flash", "xmtp/mimo-pro"]);
  });

  it("still drops a column model that cannot do what the need requires", () => {
    const ranked = rankSmartProfiles(profiles, "tool_use", "complex", config).map((c) => c.modelKey);
    expect(ranked).not.toContain("no-tools/x");
  });

  it("keeps a need's own column when it has one", () => {
    const own: SmartRoutingConfig = { ...config, overrides: { ...config.overrides, tool_use: { complex: ["xmtp/mimo-pro"] } } };
    expect(rankSmartProfiles(profiles, "tool_use", "complex", own)[0].modelKey).toBe("xmtp/mimo-pro");
  });
});
