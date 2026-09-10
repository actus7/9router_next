import { beforeEach, describe, expect, it, vi } from "vitest";

import { StreamChunkAccumulator } from "@/shared/chat/streamChunk";

const run = vi.hoisted(() => vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const get = vi.hoisted(() => vi.fn(() => undefined as Record<string, unknown> | undefined));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, transaction: (fn: () => unknown) => fn() })),
}));

const handleChat = vi.hoisted(() => vi.fn());
vi.mock("@/server/llm-gateway/chat", () => ({ handleChat }));
// The worker only forwards an API key it can prove the caller owns.
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({
  resolveApiKeyOwner: vi.fn(async () => ({ userId: "test-user", id: "key-1" })),
}));
vi.mock("@/server/llm-gateway/translator", () => ({ initTranslators: vi.fn(async () => undefined) }));

// waitUntil is the production mechanism for keeping the invocation alive past
// the response; here it just has to run the worker so the test can await it.
const pending: Array<Promise<unknown>> = [];
vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    pending.push(promise);
  },
}));

import { startDurableRun } from "@/server/application/use-cases/harness/durableRun";

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function settleCall(): [string, unknown[]] | undefined {
  const call = run.mock.calls.find(([sql]) => String(sql).includes("SET status = ?"));
  return call as [string, unknown[]] | undefined;
}

/**
 * The point of a durable run is that nobody has to still be watching. These
 * tests assert the two halves of that: the answer is written where a returning
 * reader can find it, and a run nobody settles is never left claiming to be
 * alive.
 */
describe("durable run worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    run.mockReturnValue({ changes: 1 });
  });

  it("writes the finished answer even though no caller is awaiting it", async () => {
    handleChat.mockResolvedValue(sseResponse([frame("Hello"), frame(" world"), "data: [DONE]\n\n"]));

    const { runId } = await startDurableRun({
      sessionId: "session-1",
      messageId: "message-1",
      body: { model: "gpt-4o-mini", messages: [] },
      authorization: "Bearer key",
    });
    expect(runId).toBeTruthy();

    // The HTTP response has already been sent at this point; the work is what
    // waitUntil is still holding open.
    await Promise.all(pending);

    const settle = settleCall();
    expect(settle).toBeDefined();
    expect(settle![1][0]).toBe("completed");
    expect(settle![1][1]).toBe("Hello world");
  });

  it("settles as failed when the provider call throws", async () => {
    handleChat.mockRejectedValue(new Error("provider exploded"));

    await startDurableRun({
      sessionId: "session-1",
      messageId: "message-1",
      body: { model: "gpt-4o-mini", messages: [] },
      authorization: null,
    });
    await Promise.all(pending);

    const settle = settleCall();
    expect(settle![1][0]).toBe("failed");
    expect(settle![1][5]).toBe("provider exploded");
  });

  it("stops writing when the row is no longer running", async () => {
    // A stop marks the row, so the progress UPDATE matches nothing. The worker
    // has to read that as "stop", not as a write it can ignore.
    const frames = Array.from({ length: 50 }, (_, index) => frame(`chunk-${index}`));
    handleChat.mockResolvedValue(sseResponse(frames));
    run.mockImplementation((sql: string) =>
      String(sql).includes("SET partialText") ? { changes: 0 } : { changes: 1 },
    );
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    await startDurableRun({
      sessionId: "session-1",
      messageId: "message-1",
      body: { model: "gpt-4o-mini", messages: [] },
      authorization: null,
    });
    await Promise.all(pending);

    // It must not overwrite the status the stopper set.
    expect(settleCall()).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe("StreamChunkAccumulator", () => {
  it("joins content split across chunk boundaries", () => {
    const accumulator = new StreamChunkAccumulator();
    accumulator.push('data: {"choices":[{"delta":{"content":"Hel');
    accumulator.push('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\n');
    expect(accumulator.finish().text).toBe("Hello there");
  });

  it("keeps a final frame that arrives without a trailing newline", () => {
    const accumulator = new StreamChunkAccumulator();
    accumulator.push('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
    accumulator.push('data: {"choices":[{"delta":{"content":" last"}}]}');
    expect(accumulator.finish().text).toBe("first last");
  });

  it("collects tool calls and usage alongside the text", () => {
    const accumulator = new StreamChunkAccumulator();
    accumulator.push(
      `data: ${JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "web_search", arguments: '{"q":' } }] } }],
      })}\n\n`,
    );
    accumulator.push(
      `data: ${JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      })}\n\n`,
    );
    const parsed = accumulator.finish();
    expect(parsed.toolCalls).toEqual([{ id: "call_1", name: "web_search", arguments: '{"q":"cats"}' }]);
    expect(parsed.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 4 });
  });
});
