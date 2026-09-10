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
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function get(signal?: AbortSignal) {
  const request = { signal: signal ?? new AbortController().signal } as never;
  return GET(request, { params: Promise.resolve({ runId: "run-1" }) });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The watcher polls Neon on a timer, so the only thing that matters more than
 * what it sends is that it stops. It did not: with no `cancel` and no abort
 * listener, a reader that navigated away left the loop querying forever, and
 * leaving and returning a few times stacked enough of them to hang the
 * dashboard. Both exits are asserted by counting reads after the reader is
 * gone, because "it closed the response" was already true while the loop ran.
 */
describe("durable run stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHarnessRun.mockResolvedValue(row());
  });

  it("stops polling once the reader cancels", async () => {
    const response = await get();
    const reader = response.body!.getReader();
    await reader.read();
    await sleep(1_600);

    const duringWatch = getHarnessRun.mock.calls.length;
    expect(duringWatch).toBeGreaterThan(1);

    await reader.cancel();
    await sleep(1_600);

    expect(getHarnessRun.mock.calls.length).toBe(duringWatch);
  });

  it("stops polling when the request itself aborts", async () => {
    const controller = new AbortController();
    const response = await get(controller.signal);
    const reader = response.body!.getReader();
    await reader.read();
    await sleep(1_600);

    const duringWatch = getHarnessRun.mock.calls.length;
    controller.abort();
    await sleep(1_600);

    expect(getHarnessRun.mock.calls.length).toBe(duringWatch);
    await reader.cancel().catch(() => undefined);
  });

  it("closes on its own once the run settles", async () => {
    getHarnessRun.mockResolvedValueOnce(row()).mockResolvedValue(row({ status: "completed", partialText: "done" }));

    const response = await get();
    const reader = response.body!.getReader();
    await reader.read();

    const frames: string[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      frames.push(new TextDecoder().decode(value));
    }

    expect(frames.join("")).toContain('"status":"completed"');
    const afterSettle = getHarnessRun.mock.calls.length;
    await sleep(1_600);
    expect(getHarnessRun.mock.calls.length).toBe(afterSettle);
  });

  it("settles a run whose worker died after the watcher attached", async () => {
    // The case that hung the chat: a dev-server recompile (in production, a
    // killed invocation) takes the worker out mid-write. The row stays
    // `running` with a heartbeat that stopped, so the watcher polled forever
    // and the client awaiting it never settled — leaving the composer
    // disabled. Reaping at connect time could not see this: the worker was
    // alive then.
    const dead = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    getHarnessRun
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ updatedAt: dead }))
      .mockResolvedValue(row({ status: "failed", updatedAt: dead, error: "interrupted" }));

    const response = await get();
    const reader = response.body!.getReader();

    const frames: string[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      frames.push(new TextDecoder().decode(value));
    }

    expect(failStaleHarnessRuns).toHaveBeenCalled();
    expect(frames.join("")).toContain('"status":"failed"');
  });
});
