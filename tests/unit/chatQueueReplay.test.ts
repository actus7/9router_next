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

vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat", () => ({
  executeDurableChat,
  stopDurableRun: vi.fn(),
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

describe("send targeting", () => {
  it("posts into the named conversation, not the one on screen", async () => {
    const sessions = [conversation("A"), conversation("B")];
    const sessionsRef = { current: sessions };
    const noop = () => {};

    await executeSendMessage({
      // The queued message was typed into A; the user is now reading B.
      options: { text: "follow-up", sessionId: "A" },
      activeModel: model,
      activeProviderGroup: null,
      activeSessionId: "B",
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
      abortRef: { current: null },
      activeRunIdRef: { current: null },
      setChatError: noop,
      setIsSending: noop,
      setStreamingMessageId: noop,
      setStreamingText: noop,
      setLiveActivities: noop,
      activityClearTimerRef: { current: null },
      dequeueNext: () => undefined,
      replayQueuedMessage: noop,
    } as unknown as Parameters<typeof executeSendMessage>[0]);

    const a = sessionsRef.current.find((item) => item.id === "A");
    const b = sessionsRef.current.find((item) => item.id === "B");
    expect(a?.messages.map((message) => message.content)).toEqual(["follow-up", "answer"]);
    expect(b?.messages).toEqual([]);
  });
});
