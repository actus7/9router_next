import { beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnections = vi.hoisted(() => vi.fn(async () => [] as unknown[]));

vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections,
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ providerStrategies: {}, fallbackStrategy: "fill-first" })),
}));
vi.mock("@/lib/db/repos/proxyPoolsRepo", () => ({ getProxyPools: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async () => []),
  setModelAvailability: vi.fn(),
  clearModelAvailability: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", proxyPoolId: null })),
  pickProxyPoolId: vi.fn(() => null),
}));

import { getProviderCredentials } from "@/server/llm-gateway/auth/accountSelection";

// Kilo documents unauthenticated access to its `:free` models, which is what
// makes its free router the credential-free default. The anonymous path must
// open for free models only, and never shadow an account's own Kilo key.
describe("Kilo free models without a connection", () => {
  beforeEach(() => {
    getProviderConnections.mockResolvedValue([]);
  });

  it.each(["kilo-auto/free", "nex-agi/nex-n2.5-pro:free"])("answers %s with the public credential", async (model) => {
    const credentials = await getProviderCredentials("kilo-gateway", null, model);
    expect(credentials).toMatchObject({ id: "noauth", accessToken: "public" });
  });

  it("does not open a paid model, which Kilo refuses anonymously", async () => {
    expect(await getProviderCredentials("kilo-gateway", null, "openai/gpt-5")).toBeNull();
  });

  it("uses the account's own connection when there is one", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "conn-kilo", provider: "kilo-gateway", isActive: true, apiKey: "kilo-key", priority: 1 },
    ]);
    const credentials = await getProviderCredentials("kilo-gateway", null, "kilo-auto/free");
    expect(credentials).toMatchObject({ apiKey: "kilo-key" });
  });

  it("does not extend to a provider without the flag", async () => {
    expect(await getProviderCredentials("openrouter", null, "some/model:free")).toBeNull();
  });
});
