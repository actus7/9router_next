import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testing a proxy makes the server open a connection to whatever host the
 * caller names. Over the network, a private host turns that into a scan of the
 * server's own network; from the machine itself, it is the normal case (a
 * local proxy on 127.0.0.1).
 */

const testProxyUrl = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 200 })));
const local = vi.hoisted(() => ({ value: false }));

vi.mock("@/server/application/http/tenantRoute", async () => (await import("../setup/routeWrappers")).routeWrapperMocks);
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: () => local.value }));
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => [{ address: host === "intranet.corp" ? "10.0.0.5" : "93.184.216.34", family: 4 }],
}));

import { POST } from "@/app/api/settings/proxy-test/route";

const post = (proxyUrl: string) =>
  POST(new Request("http://x/api/settings/proxy-test", { method: "POST", body: JSON.stringify({ proxyUrl }) }) as never);

beforeEach(() => {
  testProxyUrl.mockClear();
  local.value = false;
});

describe("POST /api/settings/proxy-test", () => {
  it("refuses a loopback or private proxy from across the network, before connecting", async () => {
    for (const proxyUrl of ["http://127.0.0.1:7890", "http://user:pw@192.168.0.2:3128", "http://intranet.corp:8080"]) {
      expect((await post(proxyUrl)).status).toBe(400);
    }
    expect(testProxyUrl).not.toHaveBeenCalled();
  });

  it("tests a public proxy from anywhere", async () => {
    expect((await post("http://proxy.example.com:8080")).status).toBe(200);
    expect(testProxyUrl).toHaveBeenCalledOnce();
  });

  it("tests a local proxy from the machine itself", async () => {
    local.value = true;
    expect((await post("http://127.0.0.1:7890")).status).toBe(200);
  });
});
