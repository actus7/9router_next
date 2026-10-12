import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A lane entry fixed to an account must run on that account or not at all: the
 * soft `preferredConnectionId` falls through to another account, which would
 * make two entries of the same model (one per account) collapse into one.
 */
type Row = { id: string; priority: number };
const store = vi.hoisted(() => ({ rows: [] as Row[], locked: new Map<string, string>() }));

vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => store.rows.map((row) => ({ ...row }))),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ providerStrategies: {}, fallbackStrategy: "fill-first", stickyRoundRobinLimit: 1 })),
}));
vi.mock("@/lib/db/repos/proxyPoolsRepo", () => ({ getProxyPools: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async () => [...store.locked].map(([connectionId, until]) => ({ connectionId, until }))),
  setModelAvailability: vi.fn(),
  clearModelAvailability: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(() => null),
}));

import { getProviderCredentials } from "@/server/llm-gateway/auth/accountSelection";

beforeEach(() => {
  store.rows = [{ id: "a", priority: 1 }, { id: "b", priority: 2 }];
  store.locked = new Map();
});

describe("onlyConnectionId", () => {
  it("uses the fixed account even when another one would be picked first", async () => {
    const picked = await getProviderCredentials("claude", null, "m", { onlyConnectionId: "b" });
    expect(picked?.connectionId).toBe("b");
  });

  it("never falls through to another account when the fixed one is locked for the model", async () => {
    store.locked.set("b", new Date(Date.now() + 60_000).toISOString());
    const picked = await getProviderCredentials("claude", null, "m", { onlyConnectionId: "b" });
    expect(picked?.connectionId).toBeUndefined();
    expect(picked?.allRateLimited).toBe(true);
  });

  it("returns nothing when the fixed account does not belong to the provider", async () => {
    expect(await getProviderCredentials("claude", null, "m", { onlyConnectionId: "zzz" })).toBeNull();
  });

  it("keeps the old behaviour without it", async () => {
    expect((await getProviderCredentials("claude", null, "m"))?.connectionId).toBe("a");
  });
});
