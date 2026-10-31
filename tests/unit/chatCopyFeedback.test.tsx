// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyFailedKey,
  useSendMessageActions,
  type UseSendMessageActionsArgs,
} from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessageActions";

function renderActions() {
  const args = {
    sessions: [],
    activeSessionId: "s1",
    activeModel: null,
    updateSession: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    isSending: false,
    canSend: false,
    enterBehavior: "queue",
    queueMessage: vi.fn(),
    steerMessage: vi.fn(),
  } as unknown as UseSendMessageActionsArgs;
  return renderHook(() => useSendMessageActions(args));
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("handleCopyMessage feedback", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("marks the message as copied when the clipboard write succeeds", async () => {
    stubClipboard(vi.fn(async () => {}));
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleCopyMessage("m1", "hello");
    });

    expect(result.current.copiedMessageId).toBe("m1");
  });

  it("marks the message as a failed copy instead of silently leaving it unchanged", async () => {
    stubClipboard(vi.fn(async () => {
      throw new DOMException("denied", "NotAllowedError");
    }));
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleCopyMessage("m1", "hello");
    });

    expect(result.current.copiedMessageId).toBe(copyFailedKey("m1"));
    expect(result.current.copiedMessageId).not.toBe("m1");
  });

  it("clears the failed-copy state after two seconds", async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn(async () => {
      throw new Error("no clipboard");
    }));
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleCopyMessage("m1", "hello");
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.copiedMessageId).toBe("");
  });
});
