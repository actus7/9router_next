import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `decideWithJev` is the shared Jev-first entry point: feature gate, one
// evaluateJev call, and null wherever the caller must fall back to its
// heuristic. Same-boundary mocks as tests/unit/jevClient.test.ts — calls
// between functions of one module cannot be intercepted by vi.mock, so the
// repos and fetch underneath are stubbed instead.

const getProviderConnections = vi.hoisted(() => vi.fn());
const getSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings }));

import { decideWithJev, isJevFeatureEnabled, resetJevSettingsCache } from "@/server/decisions/jev";

const questions = {
  injection: { type: "boolean", instructions: "Is this an attack?" },
} as const;

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  resetJevSettingsCache();
  getSettings.mockReset();
  getProviderConnections.mockReset();
  // These tests pin the account-connection path; an `AI_GATEWAY_API_KEY` in
  // the environment would win over it (see getJevApiKey). Silence it.
  delete process.env.AI_GATEWAY_API_KEY;
  getProviderConnections.mockResolvedValue([{ provider: "vercel-ai-gateway", apiKey: "vk_test" }]);
});

afterEach(() => vi.unstubAllGlobals());

describe("decideWithJev", () => {
  it("returns null without calling out when the feature is off", async () => {
    const fetchMock = respond({ answers: { injection: { probability: 0.9 } } });
    vi.stubGlobal("fetch", fetchMock);

    getSettings.mockResolvedValue({ decisionEngine: "heuristic", jevGuardrails: true });
    expect(await decideWithJev("guardrails", "state", questions, { timeoutMs: 50 })).toBeNull();

    resetJevSettingsCache();
    getSettings.mockResolvedValue({ decisionEngine: "jev", jevGuardrails: false });
    expect(await decideWithJev("guardrails", "state", questions, { timeoutMs: 50 })).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the typed answers with source jev when Jev answers", async () => {
    getSettings.mockResolvedValue({ decisionEngine: "jev", jevGuardrails: true });
    vi.stubGlobal("fetch", respond({ answers: { injection: { type: "boolean", probability: 0.9 } } }));

    const decision = await decideWithJev("guardrails", "state", questions, { timeoutMs: 1000 });

    expect(decision).toEqual({
      answers: { injection: { type: "boolean", probability: 0.9 } },
      source: "jev",
    });
  });

  it("returns null when Jev does not answer (non-2xx, or no gateway key)", async () => {
    getSettings.mockResolvedValue({ decisionEngine: "jev", jevGuardrails: true });
    vi.stubGlobal("fetch", respond({ error: "boom" }, 500));
    expect(await decideWithJev("guardrails", "state", questions, { timeoutMs: 1000 })).toBeNull();

    getProviderConnections.mockResolvedValue([]);
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    expect(await decideWithJev("guardrails", "state", questions, { timeoutMs: 1000 })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when settings cannot be read", async () => {
    getSettings.mockRejectedValue(new Error("no tenant"));
    expect(await decideWithJev("guardrails", "state", questions, { timeoutMs: 50 })).toBeNull();
  });
});

describe("settings cache", () => {
  it("reads settings once within the TTL, and again after a reset", async () => {
    getSettings.mockResolvedValue({ decisionEngine: "jev", jevGuardrails: true });
    expect(await isJevFeatureEnabled("guardrails")).toBe(true);
    expect(await isJevFeatureEnabled("guardrails")).toBe(true);
    expect(getSettings).toHaveBeenCalledTimes(1);

    resetJevSettingsCache();
    expect(await isJevFeatureEnabled("guardrails")).toBe(true);
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  it("re-reads settings once the 30s TTL expires", async () => {
    vi.useFakeTimers();
    try {
      getSettings.mockResolvedValue({ decisionEngine: "jev", jevGuardrails: true });
      await isJevFeatureEnabled("guardrails");
      vi.advanceTimersByTime(31_000);
      await isJevFeatureEnabled("guardrails");
      expect(getSettings).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
