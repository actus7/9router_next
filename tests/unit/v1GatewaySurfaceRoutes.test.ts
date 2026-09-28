import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quatro defeitos das rotas de superfície do `/v1`, cada um provado contra a
 * rota real (só as pontas externas mockadas):
 *
 * - `/v1/audio/voices` fazia `fetch` para `/api/media-providers/...`, que é
 *   `tenantRoute` (cookie) — sem o cookie, 401 em toda chamada;
 * - `/v1/models/info` só olhava `PROVIDER_MODELS`, então um provider com
 *   catálogo descoberto (Kilo) respondia 404 para os próprios modelos;
 * - `GET /v1` passava por `gatewayRoute` duas vezes (rate limit e lookup da
 *   chave em dobro);
 * - o estimador do `count_tokens` morava em `src/app/api`.
 */

const h = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(() => ({ allowed: true, retryAfter: 0 })),
  resolveApiKeyOwner: vi.fn(async () => ({ userId: "u1", id: "k1" })),
  customModels: [] as Record<string, unknown>[],
  ensureProviderCatalog: vi.fn(async () => {}),
  connections: [] as Record<string, unknown>[],
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({
  resolveApiKeyOwner: h.resolveApiKeyOwner,
  validateApiKey: vi.fn(async () => true),
}));
vi.mock("@/server/application/http/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  consumeRateLimit: h.consumeRateLimit,
}));
vi.mock("@/server/application/use-cases/http/v1/models/route", () => ({
  GET: vi.fn(async () => Response.json({ object: "list", data: [] })),
  OPTIONS: vi.fn(),
}));
vi.mock("@/lib/db/repos/aliasRepo", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCustomModels: vi.fn(async () => h.customModels),
}));
vi.mock("@/server/application/use-cases/models/ensureProviderCatalog", () => ({
  ensureProviderCatalog: h.ensureProviderCatalog,
}));
vi.mock("@/server/llm-gateway/application/modelResolution", () => ({
  isModelDisabled: vi.fn(async () => false),
}));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => h.connections),
}));

import { GET as v1GET } from "@/app/api/v1/route";
import { GET as infoGET } from "@/app/api/v1/models/info/route";
import { GET as voicesGET } from "@/app/api/v1/audio/voices/route";

const authed = (url: string) => new Request(url, { headers: { authorization: "Bearer sk-good" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.customModels = [];
  h.connections = [];
});

describe("GET /v1", () => {
  it("passa por gatewayRoute uma vez só", async () => {
    const res = await (v1GET as unknown as (r: Request) => Promise<Response>)(authed("http://gw.test/v1"));
    expect(res.status).toBe(200);
    expect(h.resolveApiKeyOwner).toHaveBeenCalledTimes(1);
    expect(h.consumeRateLimit).toHaveBeenCalledTimes(1);
  });
});

describe("GET /v1/models/info", () => {
  const info = (id: string) =>
    (infoGET as unknown as (r: Request) => Promise<Response>)(authed(`http://gw.test/v1/models/info?id=${encodeURIComponent(id)}`));

  it("descreve um modelo que só existe no catálogo descoberto da conta", async () => {
    h.customModels = [{ providerAlias: "kgw", id: "anthropic/claude-opus-4", type: "llm", name: "Claude Opus 4", contextLength: 200000, source: "discovered" }];
    const res = await info("kgw/anthropic/claude-opus-4");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: "kgw/anthropic/claude-opus-4", name: "Claude Opus 4", kind: "llm", owned_by: "kgw", endpoint: "/v1/chat/completions",
    });
    expect(h.ensureProviderCatalog).toHaveBeenCalledWith("kilo-gateway");
  });

  it("continua 404 para um modelo que ninguém lista", async () => {
    const res = await info("kgw/nao-existe");
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/audio/voices", () => {
  it("lista vozes em processo, sem o fetch que exigia cookie", async () => {
    h.connections = [{ apiKey: "dg-key" }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.deepgram.com/")) {
        return Response.json({ tts: [{ canonical_name: "aura-2-thalia-en", name: "thalia", languages: ["en"], metadata: { tags: ["feminine"] } }] });
      }
      return new Response("unauthorized", { status: 401 });
    });
    try {
      const res = await (voicesGET as unknown as (r: Request) => Promise<Response>)(authed("http://gw.test/v1/audio/voices?provider=deepgram"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([{ id: "aura-2-thalia-en", name: "thalia", lang: "en", gender: "feminine", model: expect.stringMatching(/\/aura-2-thalia-en$/) }]);
      expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("/api/media-providers/"))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("recusa provider sem listagem com 400", async () => {
    const res = await (voicesGET as unknown as (r: Request) => Promise<Response>)(authed("http://gw.test/v1/audio/voices?provider=nope"));
    expect(res.status).toBe(400);
  });
});

describe("estimateAnthropicInputTokens", () => {
  it("é exportado pelo servidor para outra rota reusar", async () => {
    const { estimateAnthropicInputTokens } = await import("@/server/llm-gateway/application/countTokens");
    expect(estimateAnthropicInputTokens({ system: "abcd", messages: [{ role: "user", content: [{ type: "image" }] }] })).toBe(1 + 1600);
  });
});
