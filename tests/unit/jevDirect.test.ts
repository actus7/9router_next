import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnections = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn() }));

import { evaluateJev, probeJev } from "@/server/decisions/jev";

// A key issued by TypeSafe itself (console.typesafe.ai) talks to its own API,
// not to the Vercel AI Gateway: other host, other model id, and the yes/no
// question type is called `noul` there.
describe("Jev through TypeSafe's own API", () => {
  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = "ts_test";
    delete process.env.AI_GATEWAY_API_KEY;
    getProviderConnections.mockResolvedValue([{ provider: "vercel-ai-gateway", apiKey: "vk_should_not_be_used" }]);
  });
  afterEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    vi.unstubAllGlobals();
  });

  it("posts to api.typesafe.ai with the TypeSafe key, its model id and `noul` for yes/no", async () => {
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

  it("probes the same endpoint, so the profile card tests the key that is actually used", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { ping: { type: "noul", noul: 0.9 } } })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeJev()).toMatchObject({ ok: true });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.typesafe.ai/v1/systemone");
  });
});
