import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A model switched off on its provider's page must never reach a combo — not
 * through "Suggest models with AI", not through the router's inventory. The
 * list is stored per provider alias (`kr` for Kiro), and a discovered model can
 * be stored under the alias or under the provider id, so the check must read
 * the list the same way whichever spelling the model carries.
 */
vi.mock("@/server/llm-gateway/engine/host/store", () => ({
  getProviderConnections: vi.fn(async () => [{ provider: "kiro", isActive: true }]),
  getCustomModels: vi.fn(async () => [
    { providerAlias: "kr", id: "claude-sonnet-4.5", name: "On" },
    { providerAlias: "kr", id: "claude-sonnet-4.5-thinking", name: "Off by alias" },
    { providerAlias: "kiro", id: "glm-5-agentic", name: "Off, stored under the provider id" },
  ]),
  getSmartModelProfiles: vi.fn(async () => []),
  upsertSmartModelProfiles: vi.fn(async () => {}),
  getDisabledModels: vi.fn(async () => ({ kr: ["claude-sonnet-4.5-thinking", "glm-5-agentic"] })),
  getPricingOverrides: vi.fn(async () => ({})),
}));
vi.mock("@/server/llm-gateway/engine/config/providerModels", () => ({
  getModelsByProviderId: vi.fn(() => []),
}));
vi.mock("@/server/llm-gateway/engine/providers/capabilities", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));
vi.mock("@/server/llm-gateway/engine/providers/pricing", () => ({
  getPricingForModel: vi.fn(() => null),
}));
vi.mock("@/server/decisions/jev", () => ({ decideWithJev: vi.fn(async () => null) }));

import {
  invalidateSmartProfileCache,
  refreshDeterministicSmartProfiles,
} from "@/server/llm-gateway/engine/services/smart-routing/inventory";

beforeEach(() => invalidateSmartProfileCache());

describe("smart routing inventory and switched-off models", () => {
  it("keeps the active model and leaves out the switched-off ones, whatever key they are stored under", async () => {
    const models = (await refreshDeterministicSmartProfiles()).map((profile) => profile.model);

    expect(models).toContain("claude-sonnet-4.5");
    expect(models).not.toContain("claude-sonnet-4.5-thinking");
    expect(models).not.toContain("glm-5-agentic");
  });
});
