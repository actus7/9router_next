// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useOAuthPolling } from "@/shared/components/useOAuthPolling";

describe("useOAuthPolling – stability and cleanup", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: "pending" }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("must NOT restart polling when onSuccess callback reference changes", async () => {
    const authData = { state: "test-state-123", proxyProvider: "github" };
    const onSuccess1 = vi.fn();
    const onSuccess2 = vi.fn();
    const setError = vi.fn();
    const setStep = vi.fn();

    const { rerender } = renderHook(
      ({ onSuccess }) => useOAuthPolling(authData, onSuccess, setError, setStep),
      { initialProps: { onSuccess: onSuccess1 } },
    );

    // Let first poll tick happen
    await vi.advanceTimersByTimeAsync(1500);
    const callsAfterFirst = fetchMock.mock.calls.length;

    // Change callback reference – should NOT restart the effect
    rerender({ onSuccess: onSuccess2 });

    // Advance time – poll should continue normally (one more tick)
    await vi.advanceTimersByTimeAsync(1500);

    // Exactly 1 new call (continuation), not 2 (restart + continuation)
    const newCalls = fetchMock.mock.calls.length - callsAfterFirst;
    expect(newCalls).toBe(1);
  });

  it("must NOT restart polling when setError callback reference changes", async () => {
    const authData = { state: "test-state-456", proxyProvider: "github" };
    const onSuccess = vi.fn();
    const setError1 = vi.fn();
    const setError2 = vi.fn();
    const setStep = vi.fn();

    const { rerender } = renderHook(
      ({ setError }) => useOAuthPolling(authData, onSuccess, setError, setStep),
      { initialProps: { setError: setError1 } },
    );

    await vi.advanceTimersByTimeAsync(1500);
    const callsAfterFirst = fetchMock.mock.calls.length;

    rerender({ setError: setError2 });
    await vi.advanceTimersByTimeAsync(1500);

    const newCalls = fetchMock.mock.calls.length - callsAfterFirst;
    expect(newCalls).toBe(1);
  });

  it("must NOT restart polling when setStep callback reference changes", async () => {
    const authData = { state: "test-state-789", proxyProvider: "github" };
    const onSuccess = vi.fn();
    const setError = vi.fn();
    const setStep1 = vi.fn();
    const setStep2 = vi.fn();

    const { rerender } = renderHook(
      ({ setStep }) => useOAuthPolling(authData, onSuccess, setError, setStep),
      { initialProps: { setStep: setStep1 } },
    );

    await vi.advanceTimersByTimeAsync(1500);
    const callsAfterFirst = fetchMock.mock.calls.length;

    rerender({ setStep: setStep2 });
    await vi.advanceTimersByTimeAsync(1500);

    const newCalls = fetchMock.mock.calls.length - callsAfterFirst;
    expect(newCalls).toBe(1);
  });

  it("must clear timeout on unmount (no dangling timer)", async () => {
    const authData = { state: "test-state-cleanup", proxyProvider: "github" };
    const onSuccess = vi.fn();
    const setError = vi.fn();
    const setStep = vi.fn();

    const { unmount } = renderHook(() =>
      useOAuthPolling(authData, onSuccess, setError, setStep),
    );

    // Let one tick happen
    await vi.advanceTimersByTimeAsync(1500);
    const callsBeforeUnmount = fetchMock.mock.calls.length;

    // Unmount
    unmount();

    // Advance timers significantly – no more fetches should happen
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it("must call onSuccess when status is done", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: "done" }),
      }),
    );

    const authData = { state: "test-state-done", proxyProvider: "github" };
    const onSuccess = vi.fn();
    const setError = vi.fn();
    const setStep = vi.fn();

    renderHook(() => useOAuthPolling(authData, onSuccess, setError, setStep));

    await vi.advanceTimersByTimeAsync(1500);

    expect(setStep).toHaveBeenCalledWith("success");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("must call setError when status is error", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: "error", error: "Auth denied" }),
      }),
    );

    const authData = { state: "test-state-error", proxyProvider: "github" };
    const onSuccess = vi.fn();
    const setError = vi.fn();
    const setStep = vi.fn();

    renderHook(() => useOAuthPolling(authData, onSuccess, setError, setStep));

    await vi.advanceTimersByTimeAsync(1500);

    expect(setError).toHaveBeenCalledWith("Auth denied");
    expect(setStep).toHaveBeenCalledWith("error");
  });

  it("must restart polling when authData.state changes (different OAuth flow)", async () => {
    const authData1 = { state: "state-A", proxyProvider: "github" };
    const authData2 = { state: "state-B", proxyProvider: "github" };
    const onSuccess = vi.fn();
    const setError = vi.fn();
    const setStep = vi.fn();

    const { rerender } = renderHook(
      ({ authData }) => useOAuthPolling(authData, onSuccess, setError, setStep),
      { initialProps: { authData: authData1 } },
    );

    await vi.advanceTimersByTimeAsync(1500);
    const callsAfterFirst = fetchMock.mock.calls.length;

    // Change auth state – SHOULD restart (different OAuth flow)
    rerender({ authData: authData2 });
    await vi.advanceTimersByTimeAsync(1500);

    // Should see a new fetch for the new state
    const newCalls = fetchMock.mock.calls.length - callsAfterFirst;
    expect(newCalls).toBeGreaterThanOrEqual(1);
    // Verify the new call uses state-B
    const lastCallUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(lastCallUrl).toContain("state-B");
  });
});
