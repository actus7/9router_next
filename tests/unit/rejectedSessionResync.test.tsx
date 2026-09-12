// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChatSessions } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useChatSessions";

/**
 * A conversation the server refuses must stop being offered to it.
 *
 * `rejected` means "this id can never be written" — the client records it as
 * synced so it is not pushed again. It recorded `""`, and the upsert list is
 * `synced.get(id) !== session.updatedAt`, so `""` never matched: the rejected
 * conversation went back into every subsequent flush, with its warning toast,
 * for as long as the tab stayed open.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  globalThis.localStorage?.clear();
});

function session(id: string, updatedAt: string) {
  return {
    id,
    title: id,
    providerId: "p",
    providerName: "P",
    modelId: "p:m",
    modelName: "M",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    messages: [],
  };
}

/** The PUT bodies the hook sent, in order. */
function syncPayloads(fetchMock: ReturnType<typeof vi.fn>): { sessions: { id: string }[] }[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url) === "/api/harness/sessions" && (init as RequestInit)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe("a conversation the server rejected", () => {
  it("is not pushed again on the next flush", async () => {
    globalThis.localStorage.setItem(
      "basic-chat.sessions",
      JSON.stringify([session("A", "2026-01-01T00:00:00.000Z")]),
    );
    globalThis.localStorage.setItem("basic-chat.activeSessionId", "A");

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "/api/harness/sessions" && init?.method === "PUT") {
        return new Response(JSON.stringify({ stale: [], rejected: ["A"] }), { status: 200 });
      }
      if (href.startsWith("/api/harness/sessions")) {
        return new Response(JSON.stringify({ sessions: [], deletedIds: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChatSessions({ providerGroups: [], loadingData: false, modelIndex: new Map() } as never),
    );
    // Hydration and the initial server read. No sync yet: the flush is driven
    // by a change to `sessions`, and the empty GET leaves them untouched.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // First change: A and B go up together, and the server refuses A.
    act(() => {
      result.current.setSessions((current) => [...current, session("B", "2026-01-02T00:00:00.000Z")]);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const first = syncPayloads(fetchMock);
    expect(first.flatMap((body) => body.sessions.map((item) => item.id))).toContain("A");

    // Second change, to an unrelated conversation. A itself did not change, so
    // a client that took the rejection at its word leaves it out.
    act(() => {
      result.current.setSessions((current) => [...current, session("C", "2026-01-03T00:00:00.000Z")]);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    const later = syncPayloads(fetchMock).slice(first.length);
    expect(later.flatMap((body) => body.sessions.map((item) => item.id))).toContain("C");
    expect(later.flatMap((body) => body.sessions.map((item) => item.id))).not.toContain("A");
  });
});
