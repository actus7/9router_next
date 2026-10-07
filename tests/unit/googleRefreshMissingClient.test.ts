import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * With no OAuth client configured the refresh used to POST an empty client_id
 * to Google every background tick and log a bare `invalid_request`. It now
 * stays off the network, names the cause once, and refreshes normally as soon
 * as the credentials exist — no connection needs to be recreated.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return import("@/server/llm-gateway/engine/services/tokenRefresh/providers");
}

describe("refreshGoogleToken without a client", () => {
  it("does not call Google and names the missing variables once", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const { refreshGoogleToken } = await load();

    expect(await refreshGoogleToken("rt-1", "", "", log)).toBeNull();
    expect(await refreshGoogleToken("rt-2", "", "", log)).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0].join(" ")).toMatch(/ANTIGRAVITY_OAUTH_CLIENT_ID/);
  });

  it("refreshes normally once a client is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { refreshGoogleToken } = await load();

    const result = await refreshGoogleToken("rt-3", "cid", "secret");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.accessToken).toBe("new");
  });
});
