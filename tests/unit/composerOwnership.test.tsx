// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The composer controls one conversation, so it must describe that one.
 *
 * `isSending` is true of the client — it runs one send at a time — not of the
 * conversation on screen. Reading it directly put "Stop" and the queue button
 * on *every* conversation while any one of them worked, so pressing Stop in a
 * conversation that had nothing running killed the run in another one.
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

/** A send that starts in "A" and never finishes, like a long tool step. */
function startRunInA() {
  executeSendMessage.mockImplementation(async (input: Record<string, (value: unknown) => void>) => {
    input.setSendingSessionId("A");
    input.setIsSending(true);
    input.setLiveActivities([{ id: "run-1", label: "Respondendo", state: "streaming" }]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  startRunInA();
});
afterEach(() => vi.clearAllMocks());

describe("who the composer is talking about", () => {
  it("is busy in the conversation that is actually working", async () => {
    const { result } = renderHook(({ id }: { id: string }) => useSendMessage(args(id)), {
      initialProps: { id: "A" },
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    expect(result.current.isBusy).toBe(true);
  });

  it("is not busy in a conversation that merely shares the tab", async () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSendMessage(args(id)), {
      initialProps: { id: "A" },
    });
    await act(async () => {
      await result.current.sendMessage();
    });

    rerender({ id: "B" });

    // The run is still going — just not this conversation's business.
    expect(result.current.isSending).toBe(true);
    expect(result.current.isBusy).toBe(false);
    // Queueing here would file the message behind a run in another conversation.
    expect(result.current.canQueue).toBe(false);
  });
});
