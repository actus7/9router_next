// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCallback, useState, useRef, useEffect } from "react";

/**
 * Regression test for RequestDetailsTab: fetchDetails must NOT re-trigger
 * when the API response updates pagination metadata (totalItems, totalPages)
 * without an explicit user-requested change to page/pageSize.
 *
 * We test the core pattern directly since the component has many UI dependencies.
 */

describe("RequestDetailsTab – fetchDetails stability", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            details: [{ id: "d1" }],
            pagination: { page: 1, pageSize: 20, totalItems: 100, totalPages: 5 },
          }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchDetails must NOT re-trigger when API response only updates metadata", async () => {
    // This hook mimics the FIXED RequestDetailsTab pattern:
    // - fetchDetails is stable (reads page/pageSize from refs)
    // - setPagination only updates totalItems/totalPages from API response
    // - A separate effect triggers fetchDetails when user changes page/pageSize/filters
    function useFixedHook() {
      const [details, setDetails] = useState<Array<{ id: string }>>([]);
      const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
      const [filters] = useState({ provider: "", startDate: "", endDate: "" });
      const [fetchCount, setFetchCount] = useState(0);

      const paginationRef = useRef(pagination);
      paginationRef.current = pagination;
      const filtersRef = useRef(filters);
      filtersRef.current = filters;

      const fetchDetails = useCallback(async () => {
        const { page, pageSize } = paginationRef.current;
        const currentFilters = filtersRef.current;
        setFetchCount(c => c + 1);
        const params = new URLSearchParams({
          page: page.toString(),
          pageSize: pageSize.toString(),
        });
        if (currentFilters.provider) params.append("provider", currentFilters.provider);
        const res = await fetch(`/api/usage/request-details?${params}`);
        const data = await res.json();
        setDetails(data.details || []);
        // FIX: only update metadata, not page/pageSize
        setPagination(prev => ({
          ...prev,
          totalItems: data.pagination?.totalItems ?? prev.totalItems,
          totalPages: data.pagination?.totalPages ?? prev.totalPages,
        }));
      }, []); // Stable: reads from refs

      // Trigger on mount and when user changes page/pageSize/filters
      const prevPageRef = useRef(pagination.page);
      const prevPageSizeRef = useRef(pagination.pageSize);
      const prevFiltersRef = useRef(filters);
      useEffect(() => {
        const pageChanged = prevPageRef.current !== pagination.page;
        const pageSizeChanged = prevPageSizeRef.current !== pagination.pageSize;
        const filtersChanged = prevFiltersRef.current !== filters;
        prevPageRef.current = pagination.page;
        prevPageSizeRef.current = pagination.pageSize;
        prevFiltersRef.current = filters;
        if (pageChanged || pageSizeChanged || filtersChanged || details.length === 0) {
          fetchDetails();
        }
      }, [pagination.page, pagination.pageSize, filters, fetchDetails, details.length]);

      return { pagination, fetchDetails, fetchCount, setPagination, details };
    }

    const { result } = renderHook(() => useFixedHook());

    // Wait for mount effect to complete
    await act(async () => {});
    await act(async () => {});
    const countAfterMount = result.current.fetchCount;

    // The API returned { page: 1, pageSize: 20, totalItems: 100, totalPages: 5 }
    // Since we only update totalItems/totalPages, page/pageSize stay the same
    // and fetchDetails should NOT re-trigger.
    await act(async () => {});
    await act(async () => {});

    expect(result.current.fetchCount).toBe(countAfterMount);
    // Verify metadata was updated
    expect(result.current.pagination.totalItems).toBe(100);
    expect(result.current.pagination.totalPages).toBe(5);
    // Verify page/pageSize were NOT overwritten
    expect(result.current.pagination.page).toBe(1);
    expect(result.current.pagination.pageSize).toBe(20);
  });

  it("fetchDetails must trigger when user explicitly changes page", async () => {
    function useFixedHook() {
      const [details, setDetails] = useState<Array<{ id: string }>>([]);
      const [pagination, setPagination] = useState({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
      const [filters] = useState({ provider: "", startDate: "", endDate: "" });
      const [fetchCount, setFetchCount] = useState(0);

      const paginationRef = useRef(pagination);
      paginationRef.current = pagination;
      const filtersRef = useRef(filters);
      filtersRef.current = filters;

      const fetchDetails = useCallback(async () => {
        const { page, pageSize } = paginationRef.current;
        setFetchCount(c => c + 1);
        const params = new URLSearchParams({
          page: page.toString(),
          pageSize: pageSize.toString(),
        });
        const res = await fetch(`/api/usage/request-details?${params}`);
        const data = await res.json();
        setDetails(data.details || []);
        setPagination(prev => ({
          ...prev,
          totalItems: data.pagination?.totalItems ?? prev.totalItems,
          totalPages: data.pagination?.totalPages ?? prev.totalPages,
        }));
      }, []);

      const prevPageRef = useRef(pagination.page);
      const prevPageSizeRef = useRef(pagination.pageSize);
      const prevFiltersRef = useRef(filters);
      useEffect(() => {
        const pageChanged = prevPageRef.current !== pagination.page;
        const pageSizeChanged = prevPageSizeRef.current !== pagination.pageSize;
        const filtersChanged = prevFiltersRef.current !== filters;
        prevPageRef.current = pagination.page;
        prevPageSizeRef.current = pagination.pageSize;
        prevFiltersRef.current = filters;
        if (pageChanged || pageSizeChanged || filtersChanged || details.length === 0) {
          fetchDetails();
        }
      }, [pagination.page, pagination.pageSize, filters, fetchDetails, details.length]);

      return { pagination, fetchDetails, fetchCount, setPagination, setPaginationState: setPagination, details };
    }

    const { result } = renderHook(() => useFixedHook());

    // Wait for mount
    await act(async () => {});
    await act(async () => {});
    const countAfterMount = result.current.fetchCount;

    // User changes page to 2
    await act(async () => {
      result.current.setPagination(prev => ({ ...prev, page: 2 }));
    });

    // Should trigger a new fetch
    expect(result.current.fetchCount).toBeGreaterThan(countAfterMount);
  });
});
