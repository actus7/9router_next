import { describe, it, expect, vi, beforeEach } from "vitest";

import { refreshModels } from "@/app/(dashboard)/dashboard/providers/[id]/hooks/modelRefreshHelpers";

type Call = { url: string; method: string };

function mockFetch(listing: Array<{ id: string }>, calls: Call[]): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const body = url.startsWith("/api/providers/suggested-models")
      ? { data: listing }
      : url === "/api/models/discovered"
        ? { success: true, models: [] }
        : { success: true };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
}

function args(onFetchDisabledModels = vi.fn(async () => {})) {
  return {
    providerId: "opencode",
    providerStorageAlias: "oc",
    isCompatible: false,
    connections: [],
    providerNode: null,
    customModels: [],
    modelAliases: {},
    setLiveModels: vi.fn(),
    setCustomModels: vi.fn(),
    setModelAliases: vi.fn(),
    onFetchDisabledModels,
    notify: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
  };
}

describe("refreshModels", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("clears every disabled model of the provider, including ids the new listing no longer has", async () => {
    const calls: Call[] = [];
    mockFetch([{ id: "big-pickle" }], calls);
    const onFetchDisabledModels = vi.fn(async () => {});

    await refreshModels(args(onFetchDisabledModels));

    // A DELETE without `id` drops the whole disabled list of the provider —
    // `jev-1.13-free`, disabled and gone from the listing, does not survive.
    expect(calls).toContainEqual({ url: "/api/models/disabled?providerAlias=oc", method: "DELETE" });
    expect(calls.some((c) => c.url === "/api/models/disabled" && c.method === "POST")).toBe(false);
    expect(onFetchDisabledModels).toHaveBeenCalled();
  });

  it("keeps the disabled list when the catalogue sync fails", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.startsWith("/api/providers/suggested-models")) return new Response(JSON.stringify({ data: [{ id: "big-pickle" }] }));
      if (url === "/api/models/discovered") return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      return new Response(JSON.stringify({ success: true }));
    }));

    await refreshModels(args());

    expect(calls.some((c) => c.url.startsWith("/api/models/disabled"))).toBe(false);
  });
});
