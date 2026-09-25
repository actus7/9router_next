import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The selection lock exists for the round-robin read-modify-write. It used to
 * wrap every read of the pick too, so concurrent fill-first requests — which
 * write nothing — queued behind each other's connection, availability and
 * settings queries.
 */
type Row = { id: string; priority: number; lastUsedAt?: string; consecutiveUseCount?: number };
const store = vi.hoisted(() => ({ rows: [] as Row[], strategy: "fill-first", gate: null as Promise<void> | null }));

vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => {
    if (store.gate) await store.gate;
    return store.rows.map((row) => ({ ...row }));
  }),
  updateProviderConnection: vi.fn(async (id: string, data: Partial<Row>) => {
    const row = store.rows.find((candidate) => candidate.id === id);
    if (row) Object.assign(row, data);
  }),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ providerStrategies: {}, fallbackStrategy: store.strategy, stickyRoundRobinLimit: 1 })),
}));
vi.mock("@/lib/db/repos/proxyPoolsRepo", () => ({ getProxyPools: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async () => []),
  setModelAvailability: vi.fn(),
  clearModelAvailability: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(() => null),
}));

import { getProviderCredentials } from "@/server/llm-gateway/auth/accountSelection";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";

beforeEach(() => {
  vi.clearAllMocks();
  store.rows = [{ id: "a", priority: 1 }, { id: "b", priority: 2 }];
  store.gate = null;
});

describe("account selection lock scope", () => {
  it("does not serialize concurrent fill-first picks for one provider", async () => {
    store.strategy = "fill-first";
    let open!: () => void;
    store.gate = new Promise<void>((resolve) => { open = resolve; });
    const first = getProviderCredentials("claude", null, "m");
    const second = getProviderCredentials("claude", null, "m");
    // Both reads are in flight while the first has not finished.
    await vi.waitFor(() => expect(vi.mocked(getProviderConnections)).toHaveBeenCalledTimes(2));
    open();
    expect((await first)?.connectionId).toBe("a");
    expect((await second)?.connectionId).toBe("a");
  });

  it("still serializes round-robin, so concurrent picks rotate instead of colliding", async () => {
    store.strategy = "round-robin";
    const picks = await Promise.all([
      getProviderCredentials("claude", null, "m"),
      getProviderCredentials("claude", null, "m"),
    ]);
    expect(picks.map((pick) => pick?.connectionId).sort()).toEqual(["a", "b"]);
  });
});
