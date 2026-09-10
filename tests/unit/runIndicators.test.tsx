// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRunIndicators } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useRunIndicators";

function stubStates(states: Array<{ sessionId: string; status: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ states }), { status: 200 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("useRunIndicators", () => {
  it("badges a conversation whose run is still working", async () => {
    stubStates([{ sessionId: "a", status: "running" }]);
    const { result } = renderHook(() => useRunIndicators());
    await waitFor(() => expect(result.current.get("a")).toBe("working"));
  });

  it("badges a run that finished while the conversation was closed", async () => {
    stubStates([{ sessionId: "a", status: "completed" }]);
    const { result } = renderHook(() => useRunIndicators());
    await waitFor(() => expect(result.current.get("a")).toBe("finished"));
  });

  it("prefers working over an older finished run of the same conversation", async () => {
    // Order matters here: the settled row comes first, so a naive last-write
    // map would report a busy conversation as idle.
    stubStates([
      { sessionId: "a", status: "completed" },
      { sessionId: "a", status: "running" },
    ]);
    const { result } = renderHook(() => useRunIndicators());
    await waitFor(() => expect(result.current.get("a")).toBe("working"));
  });

  it("says nothing about a run the user stopped on purpose", async () => {
    stubStates([{ sessionId: "a", status: "stopped" }]);
    const { result } = renderHook(() => useRunIndicators());
    // Nothing to announce: give the poll a chance to land, then assert absence.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.get("a")).toBeUndefined();
  });
});
