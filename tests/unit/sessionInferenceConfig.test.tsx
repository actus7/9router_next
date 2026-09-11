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
    globalThis.localStorage.setItem(
      "basic-chat.sessions",
      JSON.stringify([session("A"), session("B")]),
    );
    globalThis.localStorage.setItem("basic-chat.activeSessionId", "A");

    const { result } = renderHook(() =>
      useChatSessions({ providerGroups: [], loadingData: false, modelIndex: new Map() } as never),
    );
    await act(async () => {});

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
