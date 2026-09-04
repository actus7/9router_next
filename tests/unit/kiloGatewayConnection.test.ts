import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { testApiAirforceConnection, testKiloGatewayConnection } from "@/app/api/providers/[id]/test/testUtils";

describe("testKiloGatewayConnection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes Kilo's documented models endpoint with the configured key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(testKiloGatewayConnection("kilo_test_key")).resolves.toMatchObject({ ok: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kilo.ai/api/gateway/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer kilo_test_key" }),
      }),
    );
  });

  it("does not make a network request when no key was configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(testKiloGatewayConnection("")).resolves.toMatchObject({ ok: false, error: "Missing API key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("testApiAirforceConnection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes the Api Airforce models endpoint with the required provider headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(testApiAirforceConnection("sk-air-test")).resolves.toMatchObject({ ok: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.airforce/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-air-test",
          "HTTP-Referer": "https://endpoint-proxy.local",
          "X-Title": "Endpoint Proxy",
        }),
      }),
    );
  });
});
