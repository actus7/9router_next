import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `evaluateJev` swallows every failure on purpose — the callers fall back to a
// heuristic. That made a broken setup invisible: a free-tier Vercel account
// answers 403 on every call and the card still said "using your key". The
// probe is the one place that reports *why*.

const getProviderConnections = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn() }));

import { probeJev } from "@/server/decisions/jev";

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("probeJev", () => {
  beforeEach(() => {
    // These tests pin the account-connection path; an `AI_GATEWAY_API_KEY` in
    // the environment would win over it (see getJevApiKey). Silence it.
    delete process.env.AI_GATEWAY_API_KEY;
    getProviderConnections.mockResolvedValue([{ provider: "vercel-ai-gateway", apiKey: "vck_test" }]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ok when Jev answers a typed question", async () => {
    vi.stubGlobal("fetch", respond({ answers: { ping: { type: "boolean", probability: 0.9 } } }));
    const result = await probeJev();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("free tier: explains the 403 and points to top-up", async () => {
    vi.stubGlobal("fetch", respond({ error: { message: "Free tier users do not have access to this model. Upgrade to paid credits at https://vercel.com/x", type: "no_providers_available" } }, 403));
    const result = await probeJev();
    expect(result).toMatchObject({ ok: false, reason: "free_tier", status: 403 });
  });

  it("invalid key", async () => {
    vi.stubGlobal("fetch", respond({ error: { message: "Invalid API key" } }, 401));
    expect(await probeJev()).toMatchObject({ ok: false, reason: "unauthorized", status: 401 });
  });

  it("no gateway connection", async () => {
    getProviderConnections.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeJev()).toMatchObject({ ok: false, reason: "no_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never echoes the key in its message", async () => {
    vi.stubGlobal("fetch", respond({ error: { message: "bad key vck_test" } }, 401));
    const result = await probeJev();
    expect(JSON.stringify(result)).not.toContain("vck_test");
  });
});
