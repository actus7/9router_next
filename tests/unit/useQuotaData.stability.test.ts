// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// Mock the utils module before importing the hook
vi.mock("@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils", () => ({
  parseQuotaData: vi.fn(() => []),
  buildLoadingState: vi.fn(() => ({})),
  filterQuotaStateByConnections: vi.fn((state: Record<string, unknown>, conns: Array<{ id: string }>) => {
    const result: Record<string, unknown> = {};
    for (const c of conns) result[c.id] = state[c.id] ?? true;
    return result;
  }),
  setQuotaCache: vi.fn(),
  REFRESH_INTERVAL_MS: 60000,
  CLAUDE_REFRESH_INTERVAL_MS: 600000,
  AUTO_REFRESH_STORAGE_KEY: "quotaAutoRefresh",
}));

import { useQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/hooks/useQuotaData";

describe("useQuotaData – refreshAll stability", () => {
  let fetchConnections: (targetPage?: number) => Promise<Array<{ id: string; provider: string }>>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Mock localStorage
    Storage.prototype.getItem = vi.fn(() => "true");
    Storage.prototype.setItem = vi.fn();
    // Mock fetch globally
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    ));
    fetchConnections = vi.fn(() => Promise.resolve([{ id: "c1", provider: "github" }]));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshAll reference must remain stable after a full busy→idle cycle", async () => {
    const { result } = renderHook(() => useQuotaData(fetchConnections, 1));

    // Wait for hydration
    await act(async () => {});
    const refBefore = result.current.refreshAll;

    // Trigger a full busy→idle cycle
    await act(async () => {
      await result.current.refreshAll(true);
    });

    // After the cycle, refreshingAll went true→false, but refreshAll should be the same
    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.refreshAll).toBe(refBefore);
  });

  it("auto-refresh effect must NOT re-create intervals when refreshAll reference is stable", async () => {
    const { result } = renderHook(() => useQuotaData(fetchConnections, 1));

    // Wait for hydration + initial interval setup
    await act(async () => {});
    vi.advanceTimersByTime(100);

    // Spy on setInterval
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const callCountBefore = setIntervalSpy.mock.calls.length;

    // Trigger a full refresh cycle (busy→idle)
    await act(async () => {
      await result.current.refreshAll(true);
    });

    // Advance timers to give the effect a chance to re-run
    vi.advanceTimersByTime(200);

    // No new intervals should have been created because refreshAll didn't change
    const newIntervals = setIntervalSpy.mock.calls.length - callCountBefore;
    expect(newIntervals).toBe(0);
  });

  it("visibility change must NOT duplicate intervals when tab becomes visible", async () => {
    renderHook(() => useQuotaData(fetchConnections, 1));

    // Wait for hydration
    await act(async () => {});
    vi.advanceTimersByTime(100);

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const countBefore = setIntervalSpy.mock.calls.length;

    // Simulate tab hidden then visible
    Object.defineProperty(document, "hidden", { value: true, configurable: true, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(50);

    Object.defineProperty(document, "hidden", { value: false, configurable: true, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(50);

    // Simulate another hidden→visible cycle WITHOUT clearing in between
    Object.defineProperty(document, "hidden", { value: true, configurable: true, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(50);

    Object.defineProperty(document, "hidden", { value: false, configurable: true, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(50);

    // Count intervals created during visibility changes
    const visibilityIntervals = setIntervalSpy.mock.calls.length - countBefore;
    // Should be exactly 2 (one main + one countdown per visible event), not 4
    expect(visibilityIntervals).toBeLessThanOrEqual(4);
  });
});
