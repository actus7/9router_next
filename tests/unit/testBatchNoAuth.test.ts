import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(),
}));
vi.mock("@/app/api/providers/[id]/test/testUtils", () => ({
  testSingleConnection: vi.fn(),
  testNoAuthProvider: vi.fn(),
}));
vi.mock("@/shared/constants/providers", () => ({
  FREE_PROVIDERS: {
    "no-auth-provider": { noAuth: true, name: "NoAuth Provider" },
    "free-with-auth": { name: "Free With Auth" },
  },
  FREE_TIER_PROVIDERS: {
    "free-tier-noauth": { noAuth: true, name: "Free Tier NoAuth", serviceKinds: ["llm"] },
  },
  OAUTH_PROVIDERS: {},
  APIKEY_PROVIDERS: {},
  OPENAI_COMPATIBLE_PREFIX: "openai-compat-",
  ANTHROPIC_COMPATIBLE_PREFIX: "anthropic-compat-",
}));

import { POST } from "@/app/api/providers/test-batch/route";
import { getProviderConnections } from "@/models";
import { testSingleConnection, testNoAuthProvider } from "@/app/api/providers/[id]/test/testUtils";

function req(body: unknown): Request {
  return new Request("http://localhost/api/providers/test-batch", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/providers/test-batch (free mode, noAuth)", () => {
  it("tests noAuth providers via testNoAuthProvider even when stored connections exist", async () => {
    // Simulate a stored connection for a noAuth provider
    vi.mocked(getProviderConnections).mockResolvedValue([
      { id: "conn-1", provider: "no-auth-provider", name: "stored-conn", authType: "apikey", isActive: true },
    ] as never);
    vi.mocked(testNoAuthProvider).mockResolvedValue({ valid: true, error: null, latencyMs: 42 });

    const res = await POST(req({ mode: "free" }) as never);
    const data = await res.json();

    // testSingleConnection should NOT be called for noAuth providers
    expect(testSingleConnection).not.toHaveBeenCalled();

    // testNoAuthProvider should be called for the noAuth provider
    expect(testNoAuthProvider).toHaveBeenCalledWith("no-auth-provider");

    // The result should come from testNoAuthProvider, not the stored connection
    const noAuthResult = data.results.find((r: { provider: string }) => r.provider === "no-auth-provider");
    expect(noAuthResult).toBeDefined();
    expect(noAuthResult.valid).toBe(true);
    expect(noAuthResult.latencyMs).toBe(42);
    expect(noAuthResult.authType).toBe("noauth");
    expect(noAuthResult.connectionId).toBeNull();
  });

  it("does not mutate or delete any connection for noAuth providers", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      { id: "conn-1", provider: "no-auth-provider", name: "stored-conn", authType: "apikey", isActive: true },
    ] as never);
    vi.mocked(testNoAuthProvider).mockResolvedValue({ valid: true, error: null, latencyMs: 10 });

    await POST(req({ mode: "free" }) as never);

    // testSingleConnection (which could mutate connection state) must not be called
    expect(testSingleConnection).not.toHaveBeenCalled();
    // Only getProviderConnections is called to read; no delete/update calls
    expect(getProviderConnections).toHaveBeenCalledWith({ isActive: true });
  });

  it("tests noAuth providers via testNoAuthProvider when no stored connection exists", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([] as never);
    vi.mocked(testNoAuthProvider).mockResolvedValue({ valid: false, error: "timeout", latencyMs: 5000 });

    const res = await POST(req({ mode: "free" }) as never);
    const data = await res.json();

    expect(testNoAuthProvider).toHaveBeenCalledWith("no-auth-provider");
    expect(testNoAuthProvider).toHaveBeenCalledWith("free-tier-noauth");

    const noAuthResult = data.results.find((r: { provider: string }) => r.provider === "no-auth-provider");
    expect(noAuthResult).toBeDefined();
    expect(noAuthResult.valid).toBe(false);
    expect(noAuthResult.error).toBe("timeout");
  });

  it("still tests non-noAuth free providers via their connections", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      { id: "conn-2", provider: "free-with-auth", name: "my-key", authType: "apikey", isActive: true },
    ] as never);
    vi.mocked(testSingleConnection).mockResolvedValue({ valid: true, error: null, refreshed: false, latencyMs: 100, testedAt: new Date().toISOString() });
    vi.mocked(testNoAuthProvider).mockResolvedValue({ valid: true, error: null, latencyMs: 10 });

    const res = await POST(req({ mode: "free" }) as never);
    const data = await res.json();

    // Non-noAuth provider should be tested via testSingleConnection
    expect(testSingleConnection).toHaveBeenCalledWith("conn-2");

    const freeWithAuthResult = data.results.find((r: { provider: string }) => r.provider === "free-with-auth");
    expect(freeWithAuthResult).toBeDefined();
    expect(freeWithAuthResult.valid).toBe(true);
    expect(freeWithAuthResult.connectionId).toBe("conn-2");
  });
});
