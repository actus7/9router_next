import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tool loop had no tests at all, which is how both of these got in.
 *
 * It runs in the browser, so it is the one part of a durable run that a closed
 * tab really does stop — but stopping it must not leave work running on the
 * server, and running out of steps must not look like a finished answer.
 */

const executeDurableChat = vi.hoisted(() => vi.fn());
const executeRuntimeToolCall = vi.hoisted(() => vi.fn());

vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat", () => ({
  executeDurableChat,
}));
vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeRuntimeToolCall", () => ({
  executeRuntimeToolCall,
}));

import { runToolCallLoop } from "@/app/(dashboard)/dashboard/basic-chat/hooks/runToolCallLoop";
import type { ChatMessage, ChatSession, NormalizedModel, ToolCall } from "@/app/(dashboard)/dashboard/basic-chat/types";

const model = {
  id: "provider:model",
  requestModel: "model",
  name: "Model",
  providerId: "provider",
  providerName: "Provider",
  source: "configured",
} as NormalizedModel;

const call: ToolCall = { id: "call_1", name: "web_search", arguments: "{}" };

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "s1",
    title: "T",
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ChatSession;
}

function params(signal: AbortSignal, overrides: Partial<ChatSession> = {}) {
  const assistantMessage: ChatMessage = { id: "a1", role: "assistant", content: "" };
  const state = { session: session({ ...overrides, messages: [] }) };
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  return {
    state,
    events,
    args: {
      sessionId: "s1",
      model,
      session: session(overrides),
      assistantMessage,
      assistantMessageId: "a1",
      nextMessages: [
        { id: "u1", role: "user", content: "go" } as ChatMessage,
        assistantMessage,
      ],
      resultText: "",
      initialToolCalls: [call],
      effectiveSystemPrompt: "",
      temperature: 0.7,
      reasoningEffort: null,
      apiKey: "",
      signal,
      onRunId: () => {},
      runtimeTools: [{ type: "function", function: { name: "web_search" } }],
      enabledToolNames: new Set(["web_search"]),
      updateSession: (_id: string, updater: (s: ChatSession) => ChatSession) => {
        state.session = updater(state.session);
      },
      recordHarnessEvent: (_id: string, type: string, data: Record<string, unknown>) => {
        events.push({ type, data });
      },
      setLiveActivities: () => {},
      setStreamingMessageId: () => {},
      setStreamingText: () => {},
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tool loop and stop", () => {
  it("does not start a continuation once the run was aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { args } = params(controller.signal);

    await expect(runToolCallLoop(args)).rejects.toMatchObject({ name: "AbortError" });
    expect(executeDurableChat).not.toHaveBeenCalled();
    expect(executeRuntimeToolCall).not.toHaveBeenCalled();
  });

  it("does not start a continuation when the tool itself was aborted", async () => {
    // Pressing stop while a tool is in flight rejected the tool's fetch, and the
    // catch turned that into an error tool result and carried on — posting a new
    // durable run the user had just asked to cancel, with no watcher on it.
    executeRuntimeToolCall.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { args } = params(new AbortController().signal);

    await expect(runToolCallLoop(args)).rejects.toMatchObject({ name: "AbortError" });
    expect(executeDurableChat).not.toHaveBeenCalled();
  });
});

describe("tool step ceiling", () => {
  it("tells the user when it runs out of steps instead of showing an empty answer", async () => {
    // The model still wanted a tool on the last allowed step. The loop fell out
    // of its `for` with no handling: the final bubble was empty text with
    // status "done", and its unanswered calls stayed on the message.
    executeRuntimeToolCall.mockResolvedValue('{"ok":true}');
    executeDurableChat.mockResolvedValue({
      streamed: true,
      text: "",
      toolCalls: [{ id: "call_2", name: "web_search", arguments: "{}" }],
      reasoning: "",
      usage: null,
      responseSource: null,
      routingTrace: null,
    });

    const { args, state, events } = params(new AbortController().signal, {
      pluginSettings: { maxToolSteps: 1 },
    } as Partial<ChatSession>);

    const finalRunId = await runToolCallLoop(args);

    const last = state.session.messages.find((message) => message.id === finalRunId);
    expect(last).toBeDefined();
    expect(last?.status).toBe("error");
    expect(String(last?.content ?? "")).not.toBe("");
    expect(last?.toolCalls ?? []).toHaveLength(0);
    expect(events.some((event) => event.type === "run/end" && event.data.status === "failed")).toBe(true);
  });
});
