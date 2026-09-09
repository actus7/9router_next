// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSendMessage } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessage";
import type { UseSendMessageArgs } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessageTypes";

const noop = () => {};

function args(activeSessionId: string): UseSendMessageArgs {
  return {
    activeModel: null,
    activeProviderGroup: null,
    activeSessionId,
    setActiveSessionId: noop,
    sessions: [],
    setSessions: noop,
    updateSession: noop,
    ensureSessionForModel: () => undefined,
    draft: "",
    setDraft: noop,
    attachments: [],
    setAttachments: noop,
    systemPrompt: "",
    temperature: 1,
    reasoningEffort: null,
    enterBehavior: "queue",
    apiKey: "",
    recordHarnessEvent: noop,
  } as unknown as UseSendMessageArgs;
}

// The banner is page-level state, so a provider error from one conversation
// used to survive into the next one: it was only ever cleared at the start of
// the following send.
describe("chatError lifetime", () => {
  it("clears when a new chat switches the active session", () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSendMessage(args(sessionId)),
      { initialProps: { sessionId: "session-1" } },
    );

    act(() => result.current.setChatError("403 credits have been used up"));
    expect(result.current.chatError).toBe("403 credits have been used up");

    rerender({ sessionId: "session-2" });

    expect(result.current.chatError).toBe("");
  });

  it("clears on resetStream, which new chat calls even when it reuses an empty session", () => {
    const { result } = renderHook(() => useSendMessage(args("session-1")));

    act(() => result.current.setChatError("403 credits have been used up"));
    act(() => result.current.resetStream());

    expect(result.current.chatError).toBe("");
  });
});
