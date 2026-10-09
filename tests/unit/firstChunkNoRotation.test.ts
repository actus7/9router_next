import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "c1", backoffLevel: 0 }]),
  updateProviderConnection: vi.fn(async () => {}),
}));
const setModelAvailability = vi.fn(async () => {});
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async () => []),
  setModelAvailability: (...a: unknown[]) => setModelAvailability(...(a as [])),
  clearModelAvailability: vi.fn(async () => 0),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/proxyPoolsRepo", () => ({ getProxyPools: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(), pickProxyPoolId: vi.fn() }));
const noteBenchFailure = vi.fn(async () => false);
vi.mock("@/server/llm-gateway/auth/modelBench", () => ({ noteBenchFailure: (...a: unknown[]) => noteBenchFailure(...(a as [])), noteBenchSuccess: vi.fn() }));

import { markAccountUnavailable } from "@/server/llm-gateway/auth/accountSelection";

describe("markAccountUnavailable", () => {
  it("cools the account but does not rotate to another one after a first-chunk timeout", async () => {
    const res = await markAccountUnavailable("c1", 504, "p/m: no first byte (stream first-chunk timeout)", "p", "m");
    expect(res.shouldFallback).toBe(false);
    expect(setModelAvailability).toHaveBeenCalled();
  });

  it("still rotates on an ordinary 503", async () => {
    expect((await markAccountUnavailable("c1", 503, "down", "p", "m")).shouldFallback).toBe(true);
  });

  it("feeds the bench only with upstream-side failures, not a 429", async () => {
    noteBenchFailure.mockClear();
    await markAccountUnavailable("c1", 429, "rate limit", "p", "m");
    expect(noteBenchFailure).not.toHaveBeenCalled();
    await markAccountUnavailable("c1", 503, "down", "p", "m");
    expect(noteBenchFailure).toHaveBeenCalledTimes(1);
  });
});
