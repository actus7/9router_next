import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getProviderConnectionById } = vi.hoisted(() => ({ getProviderConnectionById: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/models", () => ({ getProviderConnectionById }));
vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
}));
vi.mock("@/lib/oauth/constants/oauth", () => ({ GEMINI_CONFIG: {} }));
vi.mock("@/server/llm-gateway/auth", () => ({
  refreshGoogleToken: vi.fn(),
  refreshCodexToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/server/llm-gateway/catalog", () => ({
  getModelsByProviderId: vi.fn(() => []),
  resolveKiroModels: vi.fn(),
  resolveKimchiModels: vi.fn(),
  resolveQoderModels: vi.fn(),
  resolveGrokCliModels: vi.fn(),
  resolveCursorModels: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
vi.mock("@/lib/providerNormalization", () => ({ normalizeProviderId: (id: string) => id }));

import { GET } from "@/app/api/providers/[id]/models/route";

describe("Api Airforce model discovery", () => {
  beforeEach(() => {
    getProviderConnectionById.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the authenticated upstream /v1/models catalog", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "airforce-connection",
      provider: "api-airforce",
      apiKey: "sk-air-test",
      providerSpecificData: {},
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "openai/gpt-test", name: "GPT Test" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/providers/airforce-connection/models"), {
      params: Promise.resolve({ id: "airforce-connection" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      provider: "api-airforce",
      models: [{ id: "openai/gpt-test" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.airforce/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-air-test" }),
      }),
    );
  });

  it("fetches Kilo Gateway's documented models catalog", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "kilo-connection",
      provider: "kilo-gateway",
      apiKey: "kilo_test_key",
      providerSpecificData: {},
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "kilo-auto/free", name: "Kilo Auto Free" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/providers/kilo-connection/models"), {
      params: Promise.resolve({ id: "kilo-connection" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      provider: "kilo-gateway",
      models: [{ id: "kilo-auto/free" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kilo.ai/api/gateway/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer kilo_test_key" }),
      }),
    );
  });

  it("fetches Poolside's OpenAI-compatible model catalog", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "poolside-connection",
      provider: "poolside",
      apiKey: "poolside_test_key",
      providerSpecificData: {},
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "poolside/laguna-s-2.1" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/providers/poolside-connection/models"), {
      params: Promise.resolve({ id: "poolside-connection" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      provider: "poolside",
      models: [{ id: "poolside/laguna-s-2.1" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://inference.poolside.ai/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer poolside_test_key" }),
      }),
    );
  });
});
