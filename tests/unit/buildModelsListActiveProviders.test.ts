import { beforeEach, describe, expect, it, vi } from "vitest";

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
// Sem rede nos testes: a descoberta dos catálogos gratuitos cai no catálogo embarcado.
vi.mock("@/server/security/safeFetch", () => ({
  safePublicFetch: vi.fn(async () => {
    throw new Error("offline");
  }),
}));
// A descoberta automática fala com o provider e com o banco; aqui só interessa
// se ela é chamada para um provider cujo catálogo ninguém conhece ainda.
vi.mock("@/server/application/use-cases/models/ensureProviderCatalog", () => ({
  ensureProviderCatalog: vi.fn(async () => {}),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (promise: Promise<unknown>) => { void promise; } }));

import { buildModelsList } from "@/server/application/use-cases/http/v1/models/route";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getCombos } from "@/lib/db/repos/combosRepo";
import { getCustomModels, getModelAliases } from "@/lib/db/repos/aliasRepo";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { safePublicFetch } from "@/server/security/safeFetch";
import { ensureProviderCatalog } from "@/server/application/use-cases/models/ensureProviderCatalog";
import { FREE_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";

const OPENAI_CONNECTION = {
  id: "conn-openai",
  provider: "openai",
  name: "openai-key",
  authType: "apikey",
  isActive: true,
  apiKey: "sk-test",
  providerSpecificData: {},
};

/** O critério do próprio gateway (`getProviderCredentials`): sem conexão, só provider noAuth. */
function isKeyless(providerId: string): boolean {
  return FREE_PROVIDERS[providerId]?.noAuth === true;
}

function ownersOf(models: Record<string, unknown>[]): string[] {
  return Array.from(new Set(models.map((model) => resolveProviderId(String(model.owned_by)))));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCombos).mockResolvedValue([] as never);
  vi.mocked(getCustomModels).mockResolvedValue([] as never);
  vi.mocked(getModelAliases).mockResolvedValue({} as never);
  vi.mocked(getDisabledModels).mockResolvedValue({} as never);
});

describe("buildModelsList — só o que o gateway consegue atender", () => {
  it("sem nenhuma conexão, não lista o catálogo de providers que exigem credencial", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([] as never);

    const models = await buildModelsList(["llm"]);

    expect(models.length).toBeGreaterThan(0);
    expect(ownersOf(models).filter((providerId) => !isKeyless(providerId))).toEqual([]);
  });

  it("com uma conexão ativa, lista o provider conectado e também os sem credencial", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([OPENAI_CONNECTION] as never);
    // O catálogo da OpenAI é descoberto, não embarcado: o que a lista publica
    // são os modelos que a descoberta gravou na conta.
    vi.mocked(getCustomModels).mockResolvedValue([
      { providerAlias: "openai", id: "gpt-5", name: "GPT-5", type: "llm", source: "discovered" },
    ] as never);

    const owners = ownersOf(await buildModelsList(["llm"]));

    expect(owners).toContain("openai");
    expect(owners.some(isKeyless)).toBe(true);
    expect(owners.filter((providerId) => providerId !== "openai" && !isKeyless(providerId))).toEqual([]);
  });

  /**
   * O provider tem endpoint de listagem, então não embarca catálogo. Sem nada
   * descoberto não há o que listar — e é por isso que a lista manda descobrir
   * antes de responder, em vez de devolver o provider vazio e esperar que
   * alguém abra o dashboard.
   */
  it("manda descobrir o catálogo de um provider conectado que ninguém conhece", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([OPENAI_CONNECTION] as never);

    await buildModelsList(["llm"]);

    expect(ensureProviderCatalog).toHaveBeenCalledWith("openai");
  });

  it("com skipDynamicFetch, usa o catálogo embarcado sem buscar na rede", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([] as never);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });

    expect(safePublicFetch).not.toHaveBeenCalled();
    expect(models.length).toBeGreaterThan(0);
  });
});
