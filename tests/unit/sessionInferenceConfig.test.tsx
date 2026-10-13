// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChatSessions } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useChatSessions";

/**
 * Inference settings describe one conversation, so they live on it.
 *
 * `systemPrompt`, `temperature` and `reasoningEffort` were page-level state in
 * a single `localStorage` key, while the plugin, skill and MCP settings edited
 * in the same dialog were per conversation. Turning the effort up for one chat
 * turned it up for every chat, and none of it survived a change of browser.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
});

function session(id: string) {
  return {
    id,
    title: id,
    providerId: "p",
    providerName: "P",
    modelId: "p:m",
    modelName: "M",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
  };
}

describe("per-conversation inference settings", () => {
  it("keeps each conversation's own values", async () => {
    // The local copy is per workspace and person (see chatSessionStorage).
    globalThis.localStorage.setItem(
      "basic-chat.sessions@t1:u1",
      JSON.stringify([session("A"), session("B")]),
    );
    globalThis.localStorage.setItem("basic-chat.activeSessionId@t1:u1", "A");
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href === "/api/access") {
        return new Response(JSON.stringify({ me: { tenantId: "t1", userId: "u1", role: "owner", personal: true }, policies: [], catalog: { plugins: [], skills: [] } }), { status: 200 });
      }
      if (href.startsWith("/api/harness/sessions")) {
        return new Response(JSON.stringify({ sessions: [], deletedIds: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));

    const { result } = renderHook(() =>
      useChatSessions({ providerGroups: [], loadingData: false, modelIndex: new Map() } as never),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    act(() => {
      result.current.setTemperature(0.2);
      result.current.setReasoningEffort("high");
      result.current.setSystemPrompt("Responda em uma frase.");
    });
    expect(result.current.temperature).toBe(0.2);

    act(() => result.current.setActiveSessionId("B"));

    // B was never configured, so it shows the defaults — not A's settings.
    expect(result.current.temperature).toBe(0.7);
    expect(result.current.reasoningEffort).toBeNull();
    expect(result.current.systemPrompt).toBe("");

    act(() => result.current.setActiveSessionId("A"));
    expect(result.current.temperature).toBe(0.2);
    expect(result.current.reasoningEffort).toBe("high");
    expect(result.current.systemPrompt).toBe("Responda em uma frase.");
  });
});
