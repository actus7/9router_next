// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "@/store/notificationStore";
import { useApiKeys } from "@/app/(dashboard)/dashboard/endpoint/hooks/useApiKeys";
import { useTailscale } from "@/app/(dashboard)/dashboard/endpoint/hooks/useTailscale";

vi.mock("@/store/notificationStore", () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("useApiKeys feedback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(notify.error).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a failed list is an error, not an empty list, and never provisions a default key", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 500));
    const { result } = renderHook(() => useApiKeys());

    await act(async () => { await result.current.fetchData(); });

    expect(result.current.loadError).toBe(true);
    expect(result.current.loading).toBe(false);
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(0);
  });

  it("an empty list that loads fine provisions the default key", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ keys: [] }))
      .mockResolvedValueOnce(json({}, 201))
      .mockResolvedValueOnce(json({ keys: [{ id: "k1", name: "Default Key", key: "sk-x", isActive: true, createdAt: "" }] }));
    const { result } = renderHook(() => useApiKeys());

    await act(async () => { await result.current.fetchData(); });

    expect(result.current.loadError).toBe(false);
    expect(result.current.keys).toHaveLength(1);
  });

  it("a refused create keeps the modal state and tells the user", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "limit" }, 400));
    const { result } = renderHook(() => useApiKeys());
    act(() => result.current.setNewKeyName("Prod"));

    await act(async () => { await result.current.handleCreateKey(); });

    expect(notify.error).toHaveBeenCalledWith("Failed to create API key");
    expect(result.current.createdKey).toBeNull();
  });

  it("a refused toggle reports the failure and leaves the key state alone", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 500));
    const { result } = renderHook(() => useApiKeys());
    act(() => result.current.setKeys([{ id: "k1", name: "A", key: "sk-a", isActive: true, createdAt: "" }]));

    await act(async () => { await result.current.handleToggleKey("k1", false); });

    expect(notify.error).toHaveBeenCalledWith("Failed to update API key");
    expect(result.current.keys[0].isActive).toBe(true);
  });
});

describe("useTailscale install feedback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a JSON refusal (no sudo password on Linux) shows its error instead of reading an event stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "sudo password required" }, 400)));
    const { result } = renderHook(() => useTailscale());

    await act(async () => { await result.current.handleInstallTailscale(); });

    await waitFor(() => expect(result.current.tsStatus).toEqual({ type: "error", message: "sudo password required" }));
    expect(result.current.tsInstalling).toBe(false);
  });
});
