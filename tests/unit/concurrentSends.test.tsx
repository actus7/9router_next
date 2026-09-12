// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two conversations can be answering at once.
 *
 * The server always allowed it -- MAX_CONCURRENT_RUNS is 12 and a run outlives
 * the tab that started it. The browser did not, and not by accident: the first
 * thing a send did was `abortRef.current?.abort()`, so starting one in a second
 * conversation killed the first. Every control then read a page-wide
 * `isSending`, so the composer in an idle conversation was disabled with no
 * explanation while another one worked.
 *
 * What made it fixable cheaply is that a ref is just an object with a
 * `current`: the send asks for its conversation's scope and keeps using the
 * same names.
 */

const executeSendMessage = vi.hoisted(() => vi.fn());
const stopDurableRun = vi.hoisted(() => vi.fn());

vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeSendMessage", () => ({
  executeSendMessage,
}));
vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat", () => ({
  executeDurableChat: vi.fn(),
  stopDurableRun,
}));

import { useSendMessage } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessage";
import type { UseSendMessageArgs } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessageTypes";

const noop = () => {};

function args(activeSessionId: string): UseSendMessageArgs {
  return {
    activeModel: { id: "p:m", requestModel: "m", name: "M", providerId: "p", providerName: "P" },
    activeProviderGroup: null,
    activeSessionId,
    setActiveSessionId: noop,
    sessions: [],
    setSessions: noop,
    updateSession: noop,
    ensureSessionForModel: () => undefined,
    draft: "rascunho",
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

interface Scope {
  abortRef: { current: AbortController | null };
  activeRunIdRef: { current: string | null };
  setSending: (sending: boolean) => void;
  setStreamingText: (value: string) => void;
}

/** The scopes handed out, by conversation, so a test can inspect one. */
const scopes = new Map<string, Scope>();

/**
 * A send that claims `sessionId`, attaches a controller and a run id, and never
 * settles -- the shape of a long tool step.
 */
function neverFinishingSendInto(sessionId: string) {
  executeSendMessage.mockImplementation(
    async (input: { beginSend: (id: string) => Scope }) => {
      const scope = input.beginSend(sessionId);
      scopes.set(sessionId, scope);
      scope.abortRef.current = new AbortController();
      scope.activeRunIdRef.current = `run-${sessionId}`;
      scope.setSending(true);
      scope.setStreamingText(`parcial de ${sessionId}`);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  scopes.clear();
});
afterEach(() => vi.clearAllMocks());

describe("a second conversation", () => {
  it("can be sent into while the first one is still answering", async () => {
    neverFinishingSendInto("A");
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSendMessage(args(id)), {
      initialProps: { id: "A" },
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    rerender({ id: "B" });

    // This was the whole limitation: `canSend` read the page-wide flag, so the
    // composer in B was dead until A finished.
    expect(result.current.isSending).toBe(true);
    expect(result.current.isBusy).toBe(false);
    expect(result.current.canSend).toBe(true);
  });

  it("does not abort the first one when it starts", async () => {
    neverFinishingSendInto("A");
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSendMessage(args(id)), {
      initialProps: { id: "A" },
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    rerender({ id: "B" });
    neverFinishingSendInto("B");
    await act(async () => {
      await result.current.sendMessage();
    });

    // The line that enforced one-at-a-time was `abortRef.current?.abort()` on
    // the way in. With one controller per conversation there is nothing there
    // for a new send to abort.
    expect(scopes.get("A")!.abortRef.current!.signal.aborted).toBe(false);
    expect(result.current.isBusy).toBe(true);
  });

  it("keeps each conversation's partial answer to itself", async () => {
    neverFinishingSendInto("A");
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSendMessage(args(id)), {
      initialProps: { id: "A" },
    });
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(result.current.streamingText).toBe("parcial de A");

    rerender({ id: "B" });
    // B has never been sent into, so it shows nothing -- not A's tokens.
    expect(result.current.streamingText).toBe("");

    neverFinishingSendInto("B");
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(result.current.streamingText).toBe("parcial de B");

    rerender({ id: "A" });
    expect(result.current.streamingText).toBe("parcial de A");
  });

  it("stops only the run of the conversation the reader is in", async () => {
    neverFinishingSendInto("A");
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSendMessage(args(id)), {
      initialProps: { id: "A" },
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    rerender({ id: "B" });
    neverFinishingSendInto("B");
    await act(async () => {
      await result.current.sendMessage();
    });

    act(() => result.current.handleStop());

    // Stop means "stop what I am reading". Aimed at the page, it reached
    // whichever run happened to have written the shared ref last.
    expect(stopDurableRun).toHaveBeenCalledWith("run-B");
    expect(stopDurableRun).not.toHaveBeenCalledWith("run-A");
    expect(scopes.get("A")!.abortRef.current!.signal.aborted).toBe(false);
  });
});
