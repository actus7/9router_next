import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/constants/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/constants/providers")>();
  return {
    ...actual,
    FREE_PROVIDERS: {
      ...actual.FREE_PROVIDERS,
      "gone-free": { id: "gone-free", alias: "gone", category: "free", name: "Gone Free", noAuth: true, retired: { reason: "host offline", since: "2026-10-31" } },
    },
  };
});

const { computeProviderEntries } = await import("@/app/(dashboard)/dashboard/providers/hooks/computeProviderEntries");

describe("providers page: retired providers", () => {
  it("lists a retired provider only under the retired group, with its reason", () => {
    const entries = computeProviderEntries("", []);
    const ids = (list: [string, unknown][]) => list.map(([id]) => id);

    expect(ids(entries.freeEntries)).not.toContain("gone-free");
    expect(ids(entries.retiredEntries)).toContain("gone-free");
    expect(entries.retiredEntries.find(([id]) => id === "gone-free")?.[1].retired?.reason).toBe("host offline");
    // Real retired providers (mimo-free, theoldllm…) ride along; each must carry its reason.
    for (const [id, info] of entries.retiredEntries) expect(info.retired?.reason, id).toBeTruthy();
  });

  it("filters the retired group by the search query like the others", () => {
    expect(computeProviderEntries("nothing-matches-this", []).retiredEntries).toEqual([]);
  });
});
