// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "agent working" card has to go away on its own.
 *
 * Its clear used to be scheduled in exactly one place — the send's `finally` —
 * so any path that never reached it left the card frozen on screen, still
 * showing whatever it was doing, until the user reloaded. Nothing running and
 * no send in flight is the whole condition, so the hook derives it instead of
 * trusting every exit to remember.
 */

const executeSendMessage = vi.hoisted(() => vi.fn());

vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeSendMessage", () => ({
  executeSendMessage,
}));
vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat", () => ({
  executeDurableChat: vi.fn(),
  stopDurableRun: vi.fn(),
}));

import { useSendMessage } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessage";
import type { UseSendMessageArgs } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessageTypes";

const noop = () => {};

function args(): UseSendMessageArgs {
  return {
    activeModel: { id: "p:m", requestModel: "m", name: "M", providerId: "p", providerName: "P" },
    activeProviderGroup: null,
    activeSessionId: "session-1",
    setActiveSessionId: noop,
    sessions: [],
    setSessions: noop,
    updateSession: noop,
    ensureSessionForModel: () => undefined,
    draft: "oi",
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("live activity lifetime", () => {
  it("clears a settled activity that no exit path scheduled a clear for", async () => {
    // Exactly the shape of the stuck screen: the turn errored, the activity was
    // marked, `isSending` was released — and nothing scheduled the removal.
    executeSendMessage.mockImplementation(async (input: Record<string, (value: unknown) => void>) => {
      input.setIsSending(true);
      input.setLiveActivities([
        { id: "run-1", label: "Pensando", detail: "Interrompida", state: "error" },
      ]);
      input.setIsSending(false);
    });

    const { result } = renderHook(() => useSendMessage(args()));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(result.current.liveActivities).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(1_000));

    expect(result.current.liveActivities).toEqual([]);
  });

  it("leaves it up long enough to be read", async () => {
    executeSendMessage.mockImplementation(async (input: Record<string, (value: unknown) => void>) => {
      input.setIsSending(true);
      input.setLiveActivities([{ id: "run-1", label: "Respondendo", state: "done" }]);
      input.setIsSending(false);
    });

    const { result } = renderHook(() => useSendMessage(args()));
    await act(async () => {
      await result.current.sendMessage();
    });
    act(() => void vi.advanceTimersByTime(400));

    expect(result.current.liveActivities).toHaveLength(1);
  });

  it("releases the composer when building the request throws", async () => {
    // `executeSendMessage` turns `isSending` on ~130 lines before its own try,
    // so anything that throws while building the request — blocked
    // localStorage, a malformed attachment — used to leave the composer
    // disabled and the card frozen until the page was reloaded.
    executeSendMessage.mockImplementation(async (input: Record<string, (value: unknown) => void>) => {
      input.setIsSending(true);
      input.setLiveActivities([{ id: "run-1", label: "Pensando", state: "running" }]);
      throw new Error("Attachment too large to encode");
    });

    const { result } = renderHook(() => useSendMessage(args()));
    await act(async () => {
      await result.current.sendMessage();
    });

    expect(result.current.isSending).toBe(false);
    expect(result.current.chatError).toContain("Attachment too large");

    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current.liveActivities).toEqual([]);
  });

  it("keeps it while the send is still running", async () => {
    executeSendMessage.mockImplementation(async (input: Record<string, (value: unknown) => void>) => {
      input.setIsSending(true);
      input.setLiveActivities([{ id: "run-1", label: "Pensando", state: "running" }]);
      // Deliberately never released: a long tool step must not time the card out.
    });

    const { result } = renderHook(() => useSendMessage(args()));
    await act(async () => {
      await result.current.sendMessage();
    });
    act(() => void vi.advanceTimersByTime(10_000));

    expect(result.current.liveActivities).toHaveLength(1);
  });
});
