import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A queued follow-up belongs to one conversation, all the way through.
 *
 * It already carried its `sessionId`, which put it in the right conversation —
 * but not with the right model, and not only when that conversation still
 * existed. Both were read from whatever was on screen at replay time.
 */

const executeDurableChat = vi.hoisted(() => vi.fn());

vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat", () => ({
  executeDurableChat,
  stopDurableRun: vi.fn(),
}));

import { executeSendMessage } from "@/app/(dashboard)/dashboard/basic-chat/hooks/executeSendMessage";
import type { ChatSession, NormalizedModel } from "@/app/(dashboard)/dashboard/basic-chat/types";

type Updater<T> = T | ((previous: T) => T);

function model(id: string): NormalizedModel {
  return {
    id,
    requestModel: id,
    name: id.toUpperCase(),
    providerId: `prov-${id}`,
    providerName: `Prov ${id}`,
    source: "configured",
  } as NormalizedModel;
}

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
    streamed: true, text: "answer", toolCalls: [], reasoning: "",
    usage: null, responseSource: null, routingTrace: null,
  });
});

describe("a replayed queue item", () => {
  it("answers with the model it was typed against, not the one on screen", async () => {
    const sessionsRef = { current: [conversation("A"), conversation("B")] };

    await executeSendMessage(args({
      // Typed in A against "alpha"; the reader has since opened B, whose model
      // is "beta" and is therefore what `activeModel` now holds.
      options: { text: "follow-up", sessionId: "A", model: model("alpha") },
      activeModel: model("beta"),
      activeSessionId: "B",
      sessionsRef,
      setSessions: (updater: Updater<ChatSession[]>) => {
        sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
    }));

    const a = sessionsRef.current.find((item) => item.id === "A");
    expect(a?.modelId).toBe("alpha");
    // The conversation the reader is looking at must not be rewritten either.
    expect(sessionsRef.current.find((item) => item.id === "B")?.modelId).toBeUndefined();
  });

  it("is dropped when its conversation was deleted, instead of resurrecting it", async () => {
    const sessionsRef = { current: [conversation("B")] };
    const setActiveSessionId = vi.fn();

    await executeSendMessage(args({
      // A was deleted while its run was still going.
      options: { text: "follow-up", sessionId: "A" },
      activeSessionId: "B",
      sessionsRef,
      setActiveSessionId,
      // The real hook always can make one — which is exactly how the replay
      // used to resurrect the deleted conversation.
      ensureSessionForModel: () => conversation("resurrected"),
      setSessions: (updater: Updater<ChatSession[]>) => {
        sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
    }));

    // No new conversation, and the reader is not dragged out of B.
    expect(sessionsRef.current.map((item) => item.id)).toEqual(["B"]);
    expect(setActiveSessionId).not.toHaveBeenCalled();
    expect(executeDurableChat).not.toHaveBeenCalled();
  });

  it("still creates a conversation for a normal send with none open", async () => {
    // The guard above must not break the ordinary path, where creating one is
    // exactly right.
    const sessionsRef = { current: [] as ChatSession[] };
    const created = conversation("fresh");

    await executeSendMessage(args({
      options: { text: "oi" },
      activeSessionId: "",
      sessionsRef,
      ensureSessionForModel: () => created,
      setSessions: (updater: Updater<ChatSession[]>) => {
        sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
    }));

    expect(sessionsRef.current.map((item) => item.id)).toEqual(["fresh"]);
  });
});

/**
 * What a send is handed once it knows its conversation. The refs and setters
 * used to be page-wide props; they are per conversation now, so the fixture
 * hands back one scope instead of a loose bag.
 */
function scopeFor(overrides: Record<string, unknown> = {}) {
  return {
    abortRef: { current: null },
    activeRunIdRef: { current: null },
    stopRequestedRef: { current: false },
    setStreamingMessageId: () => {},
    setStreamingText: () => {},
    setLiveActivities: () => {},
    setSending: () => {},
    ...overrides,
  };
}

function args(overrides: Record<string, unknown>) {
  const noop = () => {};
  const sessionsRef = { current: [conversation("A")] };
  return {
    options: { text: "hello" },
    activeModel: model("alpha"),
    activeProviderGroup: null,
    activeSessionId: "A",
    setActiveSessionId: noop,
    sessionsRef,
    setSessions: noop,
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
