import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock DB repos — must be declared before importing the module under test
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(),
}));
vi.mock("@/lib/db/repos/combosRepo", () => ({
  getCombos: vi.fn(),
}));
vi.mock("@/lib/db/repos/aliasRepo", () => ({
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(),
}));

import { buildModelsList } from "@/server/application/use-cases/http/v1/models/route";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getCombos } from "@/lib/db/repos/combosRepo";
import { getCustomModels, getModelAliases } from "@/lib/db/repos/aliasRepo";
import { getDisabledModels } from "@/lib/disabledModelsDb";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCombos).mockResolvedValue([] as never);
  vi.mocked(getCustomModels).mockResolvedValue([] as never);
  vi.mocked(getModelAliases).mockResolvedValue({} as never);
  vi.mocked(getDisabledModels).mockResolvedValue({} as never);
});

describe("buildModelsList — web providers (noAuth discovery)", () => {
  it("exposes noAuth searchViaChat providers (AnySearch, Context7) without their own connection", async () => {
    // Only an LLM provider connection exists — no web provider connections
    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "conn-openai",
        provider: "openai",
        name: "openai-key",
        authType: "apikey",
        isActive: true,
        apiKey: "sk-test",
        providerSpecificData: {},
      },
    ] as never);

    const models = await buildModelsList(["webSearch", "webFetch"]);
    const ids = models.map((m) => m.id as string);

    // AnySearch uses searchViaChat — must appear even without a connection
    expect(ids).toContain("anysearch/search");
    // Context7 uses searchViaChat — must appear even without a connection
    expect(ids).toContain("ctx7/search");
  });

  it("exposes noAuth searchConfig providers (SearXNG) without their own connection", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "conn-openai",
        provider: "openai",
        name: "openai-key",
        authType: "apikey",
        isActive: true,
        apiKey: "sk-test",
        providerSpecificData: {},
      },
    ] as never);

    const models = await buildModelsList(["webSearch", "webFetch"]);
    const ids = models.map((m) => m.id as string);

    // SearXNG uses searchConfig — must appear even without a connection
    expect(ids).toContain("searxng/search");
  });

  it("does not duplicate entries when a noAuth web provider also has a connection", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "conn-searxng",
        provider: "searxng",
        name: "searxng-conn",
        authType: "none",
        isActive: true,
        providerSpecificData: {},
      },
    ] as never);

    const models = await buildModelsList(["webSearch"]);
    const searxngEntries = models.filter((m) => (m.id as string).startsWith("searxng/"));

    // Should appear exactly once — no duplicates
    expect(searxngEntries).toHaveLength(1);
    expect(searxngEntries[0].id).toBe("searxng/search");
    expect(searxngEntries[0].kind).toBe("webSearch");
  });

  it("uses connection alias/prefix for connected web providers", async () => {
    // Exa has both searchConfig and fetchConfig
    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "conn-exa",
        provider: "exa",
        name: "exa-key",
        authType: "apikey",
        isActive: true,
        apiKey: "test-key",
        providerSpecificData: { prefix: "my-exa" },
      },
    ] as never);

    const models = await buildModelsList(["webSearch", "webFetch"]);
    const ids = models.map((m) => m.id as string);

    // Connected provider uses its connection prefix
    expect(ids).toContain("my-exa/search");
    expect(ids).toContain("my-exa/fetch");
  });

  it("only exposes web entries (search/fetch) when filtering by web kinds", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "conn-openai",
        provider: "openai",
        name: "openai-key",
        authType: "apikey",
        isActive: true,
        apiKey: "sk-test",
        providerSpecificData: {},
      },
    ] as never);

    const models = await buildModelsList(["webSearch", "webFetch"]);

    // All entries must be web entries (kind: webSearch or webFetch) — no LLM models
    for (const model of models) {
      expect(["webSearch", "webFetch"]).toContain(model.kind);
    }
  });

  it("exposes noAuth web providers even when no connections exist at all", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([] as never);

    const models = await buildModelsList(["webSearch", "webFetch"]);
    const ids = models.map((m) => m.id as string);

    // Even with zero connections, noAuth web providers must be listed
    expect(ids).toContain("anysearch/search");
    expect(ids).toContain("ctx7/search");
    expect(ids).toContain("searxng/search");
  });
});
