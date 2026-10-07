import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The daily TTL protects the Artificial Analysis quota for the automatic path.
 * A manual sync is the operator asking for a fresh snapshot now, so it skips
 * the TTL — but unlike the automatic path it reports a failure instead of
 * quietly serving the stale snapshot.
 */
vi.mock("server-only", () => ({}));
const saveAaSnapshot = vi.hoisted(() => vi.fn(async () => {}));
const getAaSnapshotMeta = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/repos/aaSnapshotRepo", () => ({
  getAaModels: vi.fn(async () => ({})),
  getAaSnapshotMeta,
  saveAaSnapshot,
}));

import { forceSyncAaSnapshot } from "@/server/application/use-cases/smart-routing/artificialAnalysis";

const page = (names: string[], hasMore = false) =>
  new Response(JSON.stringify({
    data: names.map((name) => ({ id: name, slug: name, name })),
    pagination: { has_more: hasMore },
  }), { status: 200 });

beforeEach(() => {
  vi.stubEnv("ARTIFICIAL_ANALYSIS_API_KEY", "key");
  // A snapshot fetched a minute ago: fresh for the automatic path.
  getAaSnapshotMeta.mockResolvedValue({ fetchedAt: new Date().toISOString(), indexVersion: 1, tier: "free", modelCount: 1 });
  saveAaSnapshot.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("forceSyncAaSnapshot", () => {
  it("fetches even though the stored snapshot is fresh, and saves it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page(["Model A", "Model B"]));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await forceSyncAaSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(snapshot.meta.modelCount).toBe(2);
    expect(saveAaSnapshot).toHaveBeenCalledTimes(1);
  });

  it("throws when Artificial Analysis refuses, leaving the stored snapshot alone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));

    await expect(forceSyncAaSnapshot()).rejects.toThrow(/429/);
    expect(saveAaSnapshot).not.toHaveBeenCalled();
  });

  it("says so when the API key is not configured", async () => {
    vi.stubEnv("ARTIFICIAL_ANALYSIS_API_KEY", "");

    await expect(forceSyncAaSnapshot()).rejects.toThrow(/ARTIFICIAL_ANALYSIS_API_KEY/);
  });
});
