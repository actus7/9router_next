import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A queued follow-up belongs to the conversation it was typed into.
 *
 * The send ahead of it now outlives the tab, so by the time it replays the user
 * is often reading something else. Replaying into whatever is on screen posted
 * it to the wrong conversation; refusing to replay stranded it in the queue bar
 * forever. It has to go where it was typed, whatever is on screen.
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

describe("stop before the run has an id", () => {
  it("stops the run as soon as the server names it", async () => {
    // `POST /api/harness/runs` is deliberately not given the abort signal, so
    // pressing stop in the window before it answers had nothing to name: only
    // the local abort happened, and the run went on burning quota with no
    // watcher — its answer folded into the conversation later by recovery.
    executeDurableChat.mockImplementation(async (options: { onRunId?: (id: string) => void }) => {
      options.onRunId?.("run-42");
      throw new DOMException("aborted", "AbortError");
    });

    await executeSendMessage(args({
      // Stop was pressed while the POST was still in flight.
      beginSend: () => scopeFor({ stopRequestedRef: { current: true } }),
    }));

    expect(stopDurableRun).toHaveBeenCalledWith("run-42");
  });
});

describe("send targeting", () => {
  it("posts into the named conversation, not the one on screen", async () => {
    const sessionsRef = { current: [conversation("A"), conversation("B")] };

    await executeSendMessage(args({
      // The queued message was typed into A; the user is now reading B.
      options: { text: "follow-up", sessionId: "A" },
      sessionsRef,
      setSessions: (updater: Updater<ChatSession[]>) => {
        sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
      updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
        sessionsRef.current = sessionsRef.current.map((item) =>
          item.id === sessionId ? updater(item) : item,
        );
      },
    }));

    const a = sessionsRef.current.find((item) => item.id === "A");
    const b = sessionsRef.current.find((item) => item.id === "B");
    expect(a?.messages.map((message) => message.content)).toEqual(["follow-up", "answer"]);
    expect(b?.messages).toEqual([]);
  });
});

/** The full arg bag `executeSendMessage` takes, with only the parts a test cares about set. */
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
