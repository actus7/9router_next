import { beforeEach, describe, expect, it, vi } from "vitest";

const connections = vi.fn();
const listModels = vi.fn();
const sync = vi.fn();
const kvSet = vi.fn();

vi.mock("@/lib/db/tenant", () => ({ currentTenantId: () => "u1" }));
vi.mock("@/lib/db/helpers/kvStore", () => ({ makeKv: () => ({ get: async () => Date.now(), set: kvSet }) }));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections: (...a: unknown[]) => connections(...a) }));
vi.mock("@/server/application/use-cases/http/providers/[id]/models/listConnectionModels", () => ({
  listConnectionModels: (...a: unknown[]) => listModels(...a),
}));
vi.mock("@/models", () => ({
  syncDiscoveredCustomModels: (...a: unknown[]) => sync(...a),
  pickDiscoveredMetadata: () => ({}),
  discoveredModelKind: () => "llm",
}));

const { refreshAllProviderCatalogs } = await import("@/server/application/use-cases/models/ensureProviderCatalog");

describe("refreshAllProviderCatalogs", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rediscovers every connected provider now, ignoring the 6h TTL, and reports each one", async () => {
    connections.mockImplementation(async (filter: { provider?: string }) => {
      const all = [
        { id: "c1", provider: "openrouter", isActive: true },
        { id: "c2", provider: "openrouter", isActive: true },
        { id: "c3", provider: "zai", isActive: true },
      ];
      return filter.provider ? all.filter((c) => c.provider === filter.provider) : all;
    });
    listModels.mockImplementation(async (conn: { provider: string }) =>
      conn.provider === "zai" ? { error: "401" } : { models: [{ id: "m1" }, { id: "m2" }] });

    const results = await refreshAllProviderCatalogs();

    expect(results).toEqual([
      { providerId: "openrouter", models: 2 },
      { providerId: "zai", error: "401" },
    ]);
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(kvSet).toHaveBeenCalledTimes(1);
  });
});
