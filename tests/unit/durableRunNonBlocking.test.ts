import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn((_sql: string, _params?: unknown[]): unknown => ({ changes: 1 })));
const get = vi.hoisted(() => vi.fn(() => undefined as Record<string, unknown> | undefined));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, transaction: (fn: () => unknown) => fn() })),
}));

const handleChat = vi.hoisted(() => vi.fn());
vi.mock("@/server/llm-gateway/chat", () => ({
  handleChat,
  withGatewayProfile: (_profile: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({
  resolveApiKeyOwner: vi.fn(async () => ({ userId: "test-user", id: "key-1" })),
}));
vi.mock("@/server/llm-gateway/translator", () => ({ initTranslators: vi.fn(async () => undefined) }));

const pending: Array<Promise<unknown>> = [];
vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    pending.push(promise);
  },
}));

import { startDurableRun } from "@/server/application/use-cases/harness/durableRun";
import { subscribeRun } from "@/server/application/use-cases/harness/runBus";

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** A provider stream that counts how many frames the worker actually pulled. */
function countingStream(frames: readonly string[], counter: { pulled: number }): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= frames.length) return controller.close();
        counter.pulled += 1;
        controller.enqueue(encoder.encode(frames[index++]));
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const start = () =>
  startDurableRun({
    sessionId: "session-1",
    messageId: "message-1",
    body: { model: "gpt-4o-mini", messages: [] },
    authorization: null,
  });

/**
 * The worker used to `await` every progress UPDATE inside the read loop, so a
 * slow database stalled consumption of the provider stream — and with it the
 * live client. The write is now fire-and-forget behind an in-flight flag.
 */
describe("durable run worker: progress writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    run.mockReturnValue({ changes: 1 });
    let clock = 1_000_000;
    // Every read of the clock is 300ms later, so each chunk is due a write.
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 300));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps reading the provider while a progress write is still in flight", async () => {
    const counter = { pulled: 0 };
    handleChat.mockResolvedValue(
      countingStream([frame("a"), frame("b"), frame("c"), frame("d"), "data: [DONE]\n\n"], counter),
    );
    let releaseWrite: (value: { changes: number }) => void = () => undefined;
    const hung = new Promise<{ changes: number }>((resolve) => {
      releaseWrite = resolve;
    });
    run.mockImplementation((sql: string) => (String(sql).includes("SET partialText") ? hung : { changes: 1 }));

    await start();
    await vi.waitFor(() => expect(counter.pulled).toBe(5), { timeout: 2_000 });

    releaseWrite({ changes: 1 });
    await Promise.all(pending);
    const settle = run.mock.calls.find(([sql]) => String(sql).includes("SET status = ?"));
    expect(settle![1]![1]).toBe("abcd");
  });

  it("never has two progress writes in flight at once", async () => {
    handleChat.mockResolvedValue(
      countingStream([frame("a"), frame("b"), frame("c"), "data: [DONE]\n\n"], { pulled: 0 }),
    );
    let inFlight = 0;
    let peak = 0;
    run.mockImplementation(async (sql: string) => {
      if (!String(sql).includes("SET partialText")) return { changes: 1 };
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { changes: 1 };
    });

    await start();
    await Promise.all(pending);

    expect(peak).toBe(1);
  });

  it("does not settle a run whose late progress write reports it was stopped", async () => {
    handleChat.mockResolvedValue(
      countingStream([frame("a"), frame("b"), "data: [DONE]\n\n"], { pulled: 0 }),
    );
    run.mockImplementation(async (sql: string) => {
      if (!String(sql).includes("SET partialText")) return { changes: 1 };
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { changes: 0 };
    });

    await start();
    await Promise.all(pending);

    expect(run.mock.calls.find(([sql]) => String(sql).includes("SET status = ?"))).toBeUndefined();
  });

  it("pushes the accumulated text to same-process watchers", async () => {
    handleChat.mockResolvedValue(countingStream([frame("Hello"), frame(" world"), "data: [DONE]\n\n"], { pulled: 0 }));
    const seen: Array<string | null> = [];
    // The run id is only known after start, so listen on every id through a
    // probe: the worker's own id is the only one that publishes.
    const { runId } = await (async () => {
      const result = await start();
      return result;
    })();
    const off = subscribeRun(runId, (text) => seen.push(text));
    await Promise.all(pending);
    off();

    expect(seen.filter((text): text is string => typeof text === "string").at(-1)).toBe("Hello world");
  });
});
