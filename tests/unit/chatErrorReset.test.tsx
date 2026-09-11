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

// The banner belongs to the conversation whose send failed.
//
// It used to be wiped on every conversation change. That hid the staleness
// rather than fixing it — a run outlives the tab, so it can fail long after the
// reader moved on, and the error still landed on whatever was open. Worse,
// coming back to the conversation that actually failed erased the message. The
// hook now keeps the error and `BasicChatPageClient` shows it only while
// `sendingSessionId` is the conversation on screen.
describe("chatError lifetime", () => {
  it("keeps the error when the reader moves to another conversation", () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSendMessage(args(sessionId)),
      { initialProps: { sessionId: "session-1" } },
    );

    act(() => result.current.setChatError("403 credits have been used up"));
    rerender({ sessionId: "session-2" });

    // Still held — it is session-1's, and session-1 has not been read yet.
    expect(result.current.chatError).toBe("403 credits have been used up");
  });

  it("clears on resetStream, which new chat calls even when it reuses an empty session", () => {
    const { result } = renderHook(() => useSendMessage(args("session-1")));

    act(() => result.current.setChatError("403 credits have been used up"));
    act(() => result.current.resetStream());

    expect(result.current.chatError).toBe("");
  });
});
