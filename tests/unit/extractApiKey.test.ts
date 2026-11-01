import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections: vi.fn(), updateProviderConnection: vi.fn() }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/db/repos/proxyPoolsRepo", () => ({ getProxyPools: vi.fn() }));
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(),
  setModelAvailability: vi.fn(),
  clearModelAvailability: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(), pickProxyPoolId: vi.fn() }));

import { extractApiKey } from "@/server/llm-gateway/auth/accountSelection";

const req = (headers: Record<string, string> = {}, url = "https://gw.test/v1/x") => new Request(url, { headers });

describe("extractApiKey", () => {
  it("reads a standard bearer token", () => {
    expect(extractApiKey(req({ Authorization: "Bearer k1" }))).toBe("k1");
  });
  it("accepts a lowercase scheme and trims", () => {
    expect(extractApiKey(req({ authorization: "bearer k2 " }))).toBe("k2");
  });
  it("reads x-api-key", () => {
    expect(extractApiKey(req({ "x-api-key": "k3" }))).toBe("k3");
  });
  it("reads x-goog-api-key", () => {
    expect(extractApiKey(req({ "x-goog-api-key": "k4" }))).toBe("k4");
  });
  it("reads the ?key= query parameter", () => {
    expect(extractApiKey(req({}, "https://gw.test/v1beta/models/m:generateContent?key=k5"))).toBe("k5");
  });
  it("returns null for a blank bearer token", () => {
    expect(extractApiKey(req({ Authorization: "Bearer    " }))).toBeNull();
  });
  it("returns null when nothing is sent", () => {
    expect(extractApiKey(req())).toBeNull();
  });
  it("prefers bearer over x-api-key", () => {
    expect(extractApiKey(req({ Authorization: "Bearer a", "x-api-key": "b" }))).toBe("a");
  });
});
