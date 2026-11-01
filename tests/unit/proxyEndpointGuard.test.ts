import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertProxyEndpointAllowed } from "@/server/security/providerEndpoint";

beforeEach(() => {
  vi.stubEnv("ALLOW_PRIVATE_PROVIDER_ENDPOINTS", "false");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("assertProxyEndpointAllowed", () => {
  it("rejects loopback", () => {
    expect(() => assertProxyEndpointAllowed("http://127.0.0.1:8080")).toThrow();
  });

  it("rejects the metadata address and never echoes credentials", () => {
    let message = "";
    try {
      assertProxyEndpointAllowed("http://user:pass@169.254.169.254:80");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("pass");
  });

  it("rejects a private LAN address", () => {
    expect(() => assertProxyEndpointAllowed("http://10.0.0.5:3128")).toThrow();
  });

  it("accepts a public host", () => {
    expect(() => assertProxyEndpointAllowed("http://proxy.example.com:8080")).not.toThrow();
  });

  it("accepts a public host with credentials in the URL", () => {
    expect(() => assertProxyEndpointAllowed("http://user:pass@proxy.example.com:8080")).not.toThrow();
  });

  it("accepts loopback when private endpoints are allowed", () => {
    vi.stubEnv("ALLOW_PRIVATE_PROVIDER_ENDPOINTS", "true");
    expect(() => assertProxyEndpointAllowed("http://127.0.0.1:8080")).not.toThrow();
  });

  it("rejects an invalid URL", () => {
    expect(() => assertProxyEndpointAllowed("not a url")).toThrow();
  });
});

describe("proxyAwareFetch", () => {
  it("refuses a private relay without calling fetch", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response("unexpected request"));
    vi.stubGlobal("fetch", fetchMock);
    const { proxyAwareFetch } = await import("@/server/llm-gateway/engine/utils/proxyFetch");

    await expect(
      proxyAwareFetch("https://api.example.com/x", {}, { vercelRelayUrl: "http://127.0.0.1:9" }),
    ).rejects.toMatchObject({ name: "ProviderEndpointBlockedError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a private connection proxy without calling fetch", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response("unexpected request"));
    vi.stubGlobal("fetch", fetchMock);
    const { proxyAwareFetch } = await import("@/server/llm-gateway/engine/utils/proxyFetch");

    await expect(
      proxyAwareFetch("https://api.example.com/x", {}, { connectionProxyEnabled: true, connectionProxyUrl: "http://10.0.0.5:3128" }),
    ).rejects.toMatchObject({ name: "ProviderEndpointBlockedError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the captured fetch for a public relay", async () => {
    vi.resetModules();
    const relayResponse = new Response("relayed", { status: 200 });
    const fetchMock = vi.fn(async () => relayResponse);
    vi.stubGlobal("fetch", fetchMock);
    const { proxyAwareFetch } = await import("@/server/llm-gateway/engine/utils/proxyFetch");

    const response = await proxyAwareFetch(
      "https://api.example.com/v1/embeddings?encoding=float",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      { vercelRelayUrl: "https://relay.example.com/proxy" },
    );

    expect(response).toBe(relayResponse);
    expect(await response.text()).toBe("relayed");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://relay.example.com/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-relay-target": "https://api.example.com",
        "x-relay-path": "/v1/embeddings?encoding=float",
      },
      body: "{}",
    });
  });
});

describe("custom embeddings", () => {
  it("returns a 400 for a private endpoint before calling fetch", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response("unexpected request"));
    vi.stubGlobal("fetch", fetchMock);
    const { handleEmbeddingsCore } = await import("@/server/llm-gateway/engine/handlers/embeddingsCore");

    const result = await handleEmbeddingsCore({
      body: { model: "local-embedding", input: "hello" },
      modelInfo: { provider: "custom-embedding-test", model: "local-embedding" },
      credentials: { providerSpecificData: { baseUrl: "http://127.0.0.1:11434/v1" } },
    });

    expect(result.success).toBe(false);
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({
      error: { message: expect.stringContaining("private or loopback address") },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
