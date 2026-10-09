import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentTenantId, withTenant } from "@/lib/db/tenant";

/**
 * The inventory cache used to be one module-level slot: inside its TTL, a second
 * account running a smart combo received the first account's models and
 * profiles. The cache is per account now.
 */
vi.mock("@/server/llm-gateway/engine/host/store", () => ({
  getProviderConnections: vi.fn(async () => [{ provider: "openai", isActive: true }]),
  // Each account owns a differently named custom model.
  getCustomModels: vi.fn(async () => [
    { providerAlias: "openai", id: `model-of-${currentTenantId()}`, name: "Custom" },
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

const keysFor = async (tenant: string): Promise<string[]> =>
  withTenant(tenant, async () => (await refreshDeterministicSmartProfiles()).map((p) => p.modelKey));

beforeEach(() => {
  withTenant("a", () => invalidateSmartProfileCache());
  withTenant("b", () => invalidateSmartProfileCache());
});

describe("smart routing inventory cache", () => {
  it("never serves one account's inventory to another inside the TTL", async () => {
    const a = await keysFor("a");
    const b = await keysFor("b");

    expect(a).toContain("openai/model-of-a");
    expect(b).toContain("openai/model-of-b");
    expect(b).not.toContain("openai/model-of-a");
  });

  it("still caches within one account", async () => {
    const { getCustomModels } = await import("@/server/llm-gateway/engine/host/store");
    vi.mocked(getCustomModels).mockClear();

    await keysFor("a");
    await keysFor("a");

    expect(vi.mocked(getCustomModels)).toHaveBeenCalledTimes(1);
  });

  it("invalidates only the calling account", async () => {
    const { getCustomModels } = await import("@/server/llm-gateway/engine/host/store");
    await keysFor("a");
    await keysFor("b");
    vi.mocked(getCustomModels).mockClear();

    withTenant("a", () => invalidateSmartProfileCache());
    await keysFor("a");
    await keysFor("b");

    expect(vi.mocked(getCustomModels)).toHaveBeenCalledTimes(1);
  });
});
