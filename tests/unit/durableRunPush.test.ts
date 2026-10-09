import { beforeEach, describe, expect, it, vi } from "vitest";

const getHarnessRun = vi.hoisted(() => vi.fn());
const failStaleHarnessRuns = vi.hoisted(() => vi.fn(async () => 0));

vi.mock("@/lib/db/repos/harnessRunsRepo", () => ({
  getHarnessRun,
  failStaleHarnessRuns,
  STALE_RUN_MS: 60 * 1000,
}));
vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));
vi.mock("@/lib/db/tenant", () => ({
  currentTenantId: () => "test-user",
  withTenant: (_owner: string, fn: () => unknown) => fn(),
}));

import { GET } from "@/server/application/use-cases/http/harness/runs/stream/route";
import { publishRunText } from "@/server/application/use-cases/harness/runBus";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    sessionId: "session-1",
    messageId: "message-1",
    status: "running",
    model: null,
    partialText: "",
    reasoning: null,
    toolCalls: [],
    usage: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function get(signal?: AbortSignal) {
  const request = { signal: signal ?? new AbortController().signal } as never;
  return GET(request, { params: Promise.resolve({ runId: "run-1" }) });
}

const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Text used to reach a reader up to ~1.7s late: the worker wrote once a second
 * and the watcher polled Neon every 700ms. These assert the two things that
 * closed that gap — a worker in the same process pushes text straight to its
 * watchers, and the poll that remains (other instances) is fast.
 */
describe("durable run stream latency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHarnessRun.mockResolvedValue(row());
  });

  it("forwards text pushed by a same-process worker without reading the row", async () => {
    const response = await get();
    const reader = response.body!.getReader();
    await reader.read(); // replay of the existing row
    const readsBefore = getHarnessRun.mock.calls.length;

    await sleep(30);
    publishRunText("run-1", "Hello wor");
    const { value } = await reader.read();

    expect(decode(value)).toContain('"partialText":"Hello wor"');
    expect(getHarnessRun.mock.calls.length).toBe(readsBefore);
    await reader.cancel();
  });

  it("does not rewind the reader when the row lags behind pushed text", async () => {
    const response = await get();
    const reader = response.body!.getReader();
    await reader.read();

    await sleep(30);
    publishRunText("run-1", "Hello world");
    await reader.read();

    // The (fire-and-forget) write has not landed: the row still says "Hello".
    getHarnessRun.mockResolvedValue(row({ partialText: "Hello" }));
    const frames: string[] = [];
    const deadline = Date.now() + 1_200;
    while (Date.now() < deadline) {
      const next = await Promise.race([reader.read(), sleep(400).then(() => null)]);
      if (next && !next.done) frames.push(decode(next.value));
    }

    expect(frames.filter((frame) => frame.startsWith("data:")).join("")).not.toContain('"partialText":"Hello"');
    await reader.cancel();
  });

  it("wakes up to read the row when the worker signals it is done", async () => {
    const response = await get();
    const reader = response.body!.getReader();
    await reader.read();

    getHarnessRun.mockResolvedValue(row({ status: "completed", partialText: "done" }));
    const startedAt = Date.now();
    publishRunText("run-1", null);
    const { value } = await reader.read();

    expect(decode(value)).toContain('"status":"completed"');
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("polls the row at least every ~300ms for workers on another instance", async () => {
    const response = await get();
    const reader = response.body!.getReader();
    await reader.read();

    getHarnessRun.mockResolvedValue(row({ partialText: "from another instance" }));
    const startedAt = Date.now();
    const { value } = await reader.read();

    expect(decode(value)).toContain("from another instance");
    expect(Date.now() - startedAt).toBeLessThan(450);
    await reader.cancel();
  });
});
