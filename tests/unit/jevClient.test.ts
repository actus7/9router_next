import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnections = vi.hoisted(() => vi.fn());
const getSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings }));

import { evaluateJev, isJevFeatureEnabled } from "@/server/decisions/jev";

const questions = {
  team: { type: "choice", instructions: "Which team?", criteria: { billing: "Money", tech: "Bugs" } },
  refund: { type: "boolean", instructions: "Asks for a refund?" },
} as const;

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("evaluateJev", () => {
  beforeEach(() => {
    getProviderConnections.mockResolvedValue([{ provider: "vercel-ai-gateway", apiKey: "vk_test" }]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the Vercel AI Gateway with the account's gateway key and parses typed answers", async () => {
    const fetchMock = respond({
      answers: {
        team: { type: "choice", choice: "tech", probabilities: { billing: 0.1, tech: 0.9 } },
        refund: { type: "boolean", probability: 0.2 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const answers = await evaluateJev("my app crashes", questions, 1000);

    expect(answers).toEqual({
      team: { type: "choice", choice: "tech", probabilities: { billing: 0.1, tech: 0.9 }, confidence: 0.9 },
      refund: { type: "boolean", probability: 0.2 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/evaluate");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer vk_test");
    expect(JSON.parse(String(init.body)).model).toBe("typesafe-ai/jev");
  });

  it("prefers an explicit confidence over the top probability", async () => {
    vi.stubGlobal("fetch", respond({
      answers: {
        team: { choice: "billing", confidence: 0.4, probabilities: { billing: 0.6, tech: 0.4 } },
        refund: { probability: 1 },
      },
    }));
    const answers = await evaluateJev("x", questions, 1000);
    expect(answers?.team).toMatchObject({ choice: "billing", confidence: 0.4 });
  });

  it("returns null without calling out when the account has no gateway connection", async () => {
    getProviderConnections.mockResolvedValue([]);
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    expect(await evaluateJev("x", questions, 1000)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-2xx status", respond({ error: "rate limited" }, 429)],
    ["a choice outside the criteria", respond({ answers: { team: { choice: "sales" }, refund: { probability: 0.1 } } })],
    ["a missing answer", respond({ answers: { team: { choice: "tech" } } })],
    ["a probability outside 0..1", respond({ answers: { team: { choice: "tech" }, refund: { probability: 3 } } })],
    ["a network failure", vi.fn(async () => { throw new Error("ECONNRESET"); })],
  ])("returns null on %s", async (_label, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);
    expect(await evaluateJev("x", questions, 1000)).toBeNull();
  });
});

describe("isJevFeatureEnabled", () => {
  it("needs both the Jev engine and the feature flag", async () => {
    getSettings.mockResolvedValue({ decisionEngine: "jev", jevSmartRouting: true, jevMemoryReview: false });
    expect(await isJevFeatureEnabled("smartRouting")).toBe(true);
    expect(await isJevFeatureEnabled("memoryReview")).toBe(false);

    getSettings.mockResolvedValue({ decisionEngine: "heuristic", jevSmartRouting: true });
    expect(await isJevFeatureEnabled("smartRouting")).toBe(false);
  });

  it("is off when settings cannot be read", async () => {
    getSettings.mockRejectedValue(new Error("no tenant"));
    expect(await isJevFeatureEnabled("smartRouting")).toBe(false);
  });
});
