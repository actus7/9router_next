import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Discovered models are stored as custom models. Turning a provider off only
 * deactivates its connection, so the stored models used to stay in the smart
 * routing inventory — and "Suggest models with AI" kept placing a provider the
 * operator had switched off.
 */
vi.mock("@/server/llm-gateway/engine/host/store", () => ({
  getProviderConnections: vi.fn(async () => [{ provider: "openai", isActive: true }]),
  getCustomModels: vi.fn(async () => [
    { providerAlias: "vercel-ai-gateway", id: "openai/gpt-5", name: "GPT-5 (gateway)" },
    { providerAlias: "openai", id: "custom-on-active", name: "Custom on active" },
  ]),
  getSmartModelProfiles: vi.fn(async () => []),
  upsertSmartModelProfiles: vi.fn(async () => {}),
  getDisabledModels: vi.fn(async () => ({})),
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

describe("smart routing inventory", () => {
  it("leaves out custom models whose provider has no active connection", async () => {
    const keys = (await refreshDeterministicSmartProfiles()).map((profile) => profile.modelKey);

    expect(keys.some((key) => key.startsWith("vercel-ai-gateway/"))).toBe(false);
  });

  it("keeps custom models of an active provider", async () => {
    const keys = (await refreshDeterministicSmartProfiles()).map((profile) => profile.modelKey);

    expect(keys).toContain("openai/custom-on-active");
  });
});
