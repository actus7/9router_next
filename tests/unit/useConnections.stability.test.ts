// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils", () => ({
  getSafePagination: vi.fn((p: Record<string, unknown> | null, fallback: number) =>
    p || { page: 1, pageSize: fallback, total: 0, totalPages: 1 },
  ),
  getSafeTotals: vi.fn((t: Record<string, unknown> | null, fallback: number) =>
    t || { eligibleConnections: fallback, providerFilteredConnections: fallback },
  ),
  getProviderOptions: vi.fn((o: string[] | null) => o || []),
  getPaginationPageValue: vi.fn((p: Record<string, unknown> | null, fallback: number) =>
    (p?.page as number) || fallback,
  ),
  CONNECTIONS_PAGE_SIZE: 20,
}));

import { useConnections } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/hooks/useConnections";

describe("useConnections – fetchConnections stability", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            connections: [{ id: "c1", provider: "github" }],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
            totals: { eligibleConnections: 1, providerFilteredConnections: 1 },
            providerOptions: ["github"],
          }),
      }),
    ));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchConnections reference must remain stable when setPage normalizes the page", async () => {
    const { result } = renderHook(() => useConnections());

    const refBefore = result.current.fetchConnections;

    // Simulate: API returns page=1, but getPaginationPageValue normalizes to 1 (same)
    // The key test: even if setPage is called internally, fetchConnections should not change
    await act(async () => {
      await result.current.fetchConnections(1);
    });

    // page might have been updated by setPage inside fetchConnections
    // but fetchConnections reference should be the same
    expect(result.current.fetchConnections).toBe(refBefore);
  });

  it("fetchConnections reference must remain stable even when page changes externally", async () => {
    const { result } = renderHook(() => useConnections());

    const refBefore = result.current.fetchConnections;

    // Simulate external page change (e.g., user clicks pagination)
    act(() => {
      result.current.setPage(2);
    });

    // fetchConnections should NOT change just because page changed
    // (page is no longer in its dependency array)
    expect(result.current.fetchConnections).toBe(refBefore);
  });

  it("fetchConnections uses current page as default when no targetPage is passed", async () => {
    const { result } = renderHook(() => useConnections());

    // Change page to 2
    act(() => {
      result.current.setPage(2);
    });

    // Call fetchConnections without explicit page
    await act(async () => {
      await result.current.fetchConnections();
    });

    // Should have used page=2 as the default
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const lastCallUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(lastCallUrl).toContain("page=2");
  });
});
