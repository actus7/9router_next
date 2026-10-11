import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnections = vi.hoisted(() => vi.fn());
const getTypesafeKey = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/db/repos/decisionKeysRepo", () => ({ getTypesafeKey }));

import { evaluateJev, probeJev } from "@/server/decisions/jev";

// A key issued by TypeSafe itself (console.typesafe.ai), saved on the account
// from the profile card, talks to its own API rather than the Vercel AI
// Gateway: other host, other model id, and yes/no is called `noul` there.
describe("Jev through TypeSafe's own API", () => {
  beforeEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
    getTypesafeKey.mockResolvedValue("ts_test");
    getProviderConnections.mockResolvedValue([{ provider: "vercel-ai-gateway", apiKey: "vk_should_not_be_used" }]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts to api.typesafe.ai with the account's TypeSafe key, its model id and `noul` for yes/no", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { refund: { type: "noul", noul: 0.8 } } })));
    vi.stubGlobal("fetch", fetchMock);
    const answers = await evaluateJev("give me my money back", { refund: { type: "boolean", instructions: "Asks for a refund?" } }, 1000);
    expect(answers).toEqual({ refund: { type: "boolean", probability: 0.8 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ts_test");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-latest");
    expect(body.questions.refund.type).toBe("noul");
  });

  it("keeps a System One model a caller picked, without the gateway's provider prefix", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { x: { type: "noul", noul: 0.1 } } })));
    vi.stubGlobal("fetch", fetchMock);
    await evaluateJev("s", { x: { type: "boolean", instructions: "?" } }, 1000, "typesafe-ai/jev-1.13");
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model).toBe("jev-1.13");
  });

  it("uses the gateway when the account has no TypeSafe key", async () => {
    getTypesafeKey.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { x: { type: "boolean", probability: 0.1 } } })));
    vi.stubGlobal("fetch", fetchMock);
    await evaluateJev("s", { x: { type: "boolean", instructions: "?" } }, 1000);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://ai-gateway.vercel.sh/v1/evaluate");
  });

  it("probes the TypeSafe endpoint, and can probe a key before it is saved", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { ping: { type: "noul", noul: 0.9 } } })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeJev()).toMatchObject({ ok: true });
    await probeJev(1000, { typesafeKey: "ts_candidate" });
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ts_candidate");
  });
});
