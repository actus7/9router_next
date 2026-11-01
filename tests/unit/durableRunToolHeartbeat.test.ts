import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const get = vi.hoisted(() => vi.fn(() => undefined as Record<string, unknown> | undefined));

vi.mock("@/lib/db/repos/accessPoliciesRepo", () => ({ accessLayersFor: vi.fn(async () => []), accessLayersForActor: vi.fn(async () => []), usageLimitsFor: vi.fn(async () => []) }));
vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, transaction: (fn: () => unknown) => fn() })),
}));

const handleChat = vi.hoisted(() => vi.fn());
const withGatewayProfile = vi.hoisted(() => vi.fn((_profile: unknown, fn: () => unknown) => fn()));
vi.mock("@/server/llm-gateway/chat", () => ({ handleChat, withGatewayProfile }));
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({
  resolveApiKeyOwner: vi.fn(async () => ({ userId: "test-user", id: "key-1" })),
}));
vi.mock("@/server/llm-gateway/translator", () => ({ initTranslators: vi.fn(async () => undefined) }));

const runServerToolLoop = vi.hoisted(() => vi.fn());
vi.mock("@/server/harness/tools/serverToolLoop", () => ({ runServerToolLoop }));

const pending: Array<Promise<unknown>> = [];
vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    pending.push(promise);
  },
}));

import { startDurableRun } from "@/server/application/use-cases/harness/durableRun";

const TOOL_CALL_FRAME = `data: ${JSON.stringify({
  choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "web_search", arguments: "{}" } }] } }],
})}\n\n`;

function toolTurnResponse(): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(TOOL_CALL_FRAME));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function touchCount(): number {
  return run.mock.calls.filter(([sql]) => /SET updatedAt = \?/.test(String(sql))).length;
}

describe("durable run heartbeat during the tool loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    pending.length = 0;
    run.mockReturnValue({ changes: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps touching the row while a tool step runs, and stops afterwards", async () => {
    // A tool step longer than STALE_RUN_MS used to leave the row untouched, so
    // a reader failed a run whose worker was alive and fine.
    handleChat.mockResolvedValue(toolTurnResponse());
    let finishLoop: (value: unknown) => void = () => undefined;
    runServerToolLoop.mockImplementation(
      () => new Promise((resolve) => { finishLoop = resolve; }),
    );

    await startDurableRun({
      sessionId: "session-1",
      messageId: "message-1",
      body: { model: "gpt-4o-mini", messages: [] },
      authorization: null,
    });

    await vi.advanceTimersByTimeAsync(65_000);
    expect(runServerToolLoop).toHaveBeenCalledTimes(1);
    expect(touchCount()).toBeGreaterThanOrEqual(10);

    finishLoop({ text: "done", leftoverToolCalls: [], reasoning: "", usage: null });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(pending);

    const afterLoop = touchCount();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(touchCount()).toBe(afterLoop);
  });
});
