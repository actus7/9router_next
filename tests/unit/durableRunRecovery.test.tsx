// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDurableRunRecovery } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useDurableRunRecovery";
import type { ChatMessage, ChatSession } from "@/app/(dashboard)/dashboard/basic-chat/types";

function session(message: Partial<ChatMessage>): ChatSession {
  return {
    id: "session-1",
    title: "Test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        content: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        ...message,
      } as ChatMessage,
    ],
  } as ChatSession;
}

function sseResponse(frames: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    sessionId: "session-1",
    messageId: "message-1",
    status: "running",
    partialText: "",
    reasoning: null,
    usage: null,
    error: null,
    ...overrides,
  };
}

/** Renders the hook and returns the message as the last update left it. */
function mount(initial: ChatSession) {
  let current = initial;
  const updateSession = vi.fn((_id: string, updater: (session: ChatSession) => ChatSession) => {
    current = updater(current);
  });
  renderHook(() =>
    useDurableRunRecovery({ activeSessionId: "session-1", isReady: true, updateSession }),
  );
  return { message: () => current.messages[0]!, updateSession };
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Coming back to a chat is the whole point of a durable run, and it is where
 * this first broke: the run kept going on the server, but nothing in the
 * remounted page was reading it, so the answer sat truncated on screen and
 * never moved again.
 */
describe("useDurableRunRecovery", () => {
  it("re-attaches to a run that is still going and finishes the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/stream")) {
          return sseResponse([
            run({ partialText: "Hello" }),
            run({ partialText: "Hello world", status: "completed" }),
          ]);
        }
        return new Response(JSON.stringify({ runs: [run()] }), { status: 200 });
      }),
    );

    const { message } = mount(session({ content: "Hel", status: "streaming" }));

    await waitFor(() => expect(message().content).toBe("Hello world"));
    expect(message().status).toBe("done");
  });

  it("completes a message the interrupted tab already settled as done", async () => {
    // Leaving mid-answer aborts the local fetch, and that abort handler marks
    // the message `done` with whatever text had arrived. It looks finished and
    // is not — the run, not the interrupted tab, knows the full answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ runs: [run({ status: "completed", partialText: "the whole answer" })] }),
          { status: 200 },
        ),
      ),
    );

    const { message } = mount(session({ content: "the wh", status: "done" }));

    await waitFor(() => expect(message().content).toBe("the whole answer"));
  });

  it("leaves a locally finished message alone when the run adds nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ runs: [run({ status: "completed", partialText: "same" })] }),
          { status: 200 },
        ),
      ),
    );

    const { message, updateSession } = mount(session({ content: "same", status: "done" }));

    await waitFor(() => expect(updateSession).toHaveBeenCalled());
    expect(message().content).toBe("same");
    expect(message().status).toBe("done");
  });

  it("surfaces a run that died on the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ runs: [run({ status: "failed", error: "provider exploded" })] }),
          { status: 200 },
        ),
      ),
    );

    const { message } = mount(session({ content: "", status: "streaming" }));

    await waitFor(() => expect(message().status).toBe("error"));
    expect(message().content).toContain("provider exploded");
  });
});
