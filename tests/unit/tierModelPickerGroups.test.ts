import { describe, expect, it } from "vitest";

import { buildProviderGroups } from "@/shared/components/buildProviderGroups";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";

const allProviders = AI_PROVIDERS as unknown as Record<string, Record<string, unknown>>;

function discovered(providerId: string, ids: string[]) {
  return ids.map((id) => ({ id, name: id, providerAlias: getProviderAlias(providerId) }));
}

describe("combo tier picker groups", () => {
  // The provider page lets an operator switch most of Kiro's models off; the
  // combo picker kept offering all of them because it never read that list.
  it("leaves out the models switched off on the provider page", () => {
    const alias = getProviderAlias("kiro");
    const groups = buildProviderGroups({
      sortedProviderIds: ["kiro"],
      allProviders,
      activeProviders: [{ provider: "kiro" }],
      modelAliases: {},
      providerNodes: [],
      customModels: discovered("kiro", ["claude-sonnet-4.5", "claude-sonnet-4.5-thinking", "glm-5-agentic"]),
      disabledModels: { [alias]: ["claude-sonnet-4.5-thinking", "glm-5-agentic"] },
    });
    const values = groups.kiro?.models.map((model) => model.id) ?? [];
    expect(values).toContain("claude-sonnet-4.5");
    expect(values).not.toContain("claude-sonnet-4.5-thinking");
    expect(values).not.toContain("glm-5-agentic");
  });

  it("drops a provider whose every model is switched off", () => {
    const groups = buildProviderGroups({
      sortedProviderIds: ["kiro"],
      allProviders,
      activeProviders: [{ provider: "kiro" }],
      modelAliases: {},
      providerNodes: [],
      customModels: discovered("kiro", ["only-one"]),
      disabledModels: { kiro: ["only-one"] },
    });
    expect(groups.kiro).toBeUndefined();
  });
});
