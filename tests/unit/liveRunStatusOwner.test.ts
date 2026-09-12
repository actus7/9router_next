import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Agente trabalhando" belongs to a conversation, not to the page.
 *
 * `isSending` and `liveActivities` were page-level state with no owner, so the
 * card followed the reader: open a second conversation while the first was
 * answering and it sat there claiming that *this* one was working. Runs outlive
 * the tab now, so reading something else while one answers is the normal case,
 * not the edge one.
 */

const executeDurableChat = vi.hoisted(() => vi.fn());
const stopDurableRun = vi.hoisted(() => vi.fn());

vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat", () => ({
  executeDurableChat,
  stopDurableRun,
}));

import { executeSendMessage } from "@/app/(dashboard)/dashboard/basic-chat/hooks/executeSendMessage";
import type { ChatSession, NormalizedModel } from "@/app/(dashboard)/dashboard/basic-chat/types";

type Updater<T> = T | ((previous: T) => T);

const model = {
  id: "provider:model",
  requestModel: "model",
  name: "Model",
  providerId: "provider",
  providerName: "Provider",
  source: "configured",
} as NormalizedModel;

function conversation(id: string): ChatSession {
  return {
    id,
    title: "Kept",
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as ChatSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  executeDurableChat.mockResolvedValue({
    streamed: true,
    text: "answer",
    toolCalls: [],
    reasoning: "",
    usage: null,
    responseSource: null,
    routingTrace: null,
  });
});

describe("who the live run status belongs to", () => {
  // The send names its conversation by claiming it — `beginSend(sessionId)` is
  // what hands back that conversation's abort controller, run id and stream
  // state. It replaced a `setSendingSessionId` call that said the same thing
  // and owned nothing, so the claim is what these assert now.
  it("names the conversation the send went into, not the one on screen", async () => {
    const beginSend = vi.fn(() => scopeFor());

    await executeSendMessage(args({
      // Typed into A; the user is reading B by the time this runs.
      options: { text: "follow-up", sessionId: "A" },
      activeSessionId: "B",
      beginSend,
    }));

    expect(beginSend).toHaveBeenCalledWith("A");
    expect(beginSend).not.toHaveBeenCalledWith("B");
  });

  it("names it before the answer arrives, so the card is never orphaned", async () => {
    const calls: string[] = [];
    executeDurableChat.mockImplementation(async () => {
      calls.push("stream");
      return { streamed: true, text: "answer", toolCalls: [], reasoning: "", usage: null, responseSource: null, routingTrace: null };
    });

    await executeSendMessage(args({
      beginSend: (id: string) => {
        calls.push(`owner:${id}`);
        return scopeFor();
      },
    }));

    expect(calls[0]).toBe("owner:A");
  });
});

/** What a send owns once it has claimed its conversation. */
function scopeFor() {
  return {
    abortRef: { current: null },
    activeRunIdRef: { current: null },
    stopRequestedRef: { current: false },
    setStreamingMessageId: () => {},
    setStreamingText: () => {},
    setLiveActivities: () => {},
    setSending: () => {},
  };
}

/** The full arg bag `executeSendMessage` takes, with only the parts a test cares about set. */
function args(overrides: Record<string, unknown>) {
  const noop = () => {};
  const sessionsRef = { current: [conversation("A"), conversation("B")] };
  return {
    options: { text: "hello" },
    activeModel: model,
    activeProviderGroup: null,
    activeSessionId: "A",
    setActiveSessionId: noop,
    sessionsRef,
    setSessions: (updater: Updater<ChatSession[]>) => {
      sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
    },
    ensureSessionForModel: () => undefined,
    draft: "",
    setDraft: noop,
    attachments: [],
    setAttachments: noop,
    systemPrompt: "",
    temperature: 0.7,
    reasoningEffort: null,
    apiKey: "",
    recordHarnessEvent: noop,
    updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
      sessionsRef.current = sessionsRef.current.map((item) =>
        item.id === sessionId ? updater(item) : item,
      );
    },
    setChatError: noop,
    beginSend: () => scopeFor(),
    dequeueNext: () => undefined,
    replayQueuedMessage: noop,
    ...overrides,
  } as unknown as Parameters<typeof executeSendMessage>[0];
}
