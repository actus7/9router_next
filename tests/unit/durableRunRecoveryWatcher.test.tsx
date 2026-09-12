// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A run already being watched is not the recovery's to watch.
 *
 * The recovery effect re-runs on every conversation change, so A → B → A while
 * A was still answering attached a *second* watcher to the same run. When it
 * finished it deleted the run row, and the send's own watcher — still reading
 * the stream — ran out without a terminal status and reported the finished
 * answer as "interrupted". It also burns two of the eight watcher slots.
 */

const watchDurableRun = vi.hoisted(() => vi.fn());

vi.mock("@/app/(dashboard)/dashboard/basic-chat/hooks/executeDurableChat", () => ({
  watchDurableRun,
}));

import { useDurableRunRecovery } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useDurableRunRecovery";

const RUNNING = {
  id: "run-1",
  sessionId: "A",
  messageId: "msg-1",
  status: "running",
  partialText: "half",
  reasoning: null,
  usage: null,
  error: null,
};

function stubRuns(runs: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ runs }), { status: 200 })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  watchDurableRun.mockResolvedValue({ text: "whole", reasoning: null, usage: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("durable run recovery", () => {
  it("leaves the run the send is already watching alone", async () => {
    stubRuns([RUNNING]);

    renderHook(() =>
      useDurableRunRecovery({
        activeSessionId: "A",
        isReady: true,
        updateSession: () => {},
        isRunWatched: (runId: string) => runId === "run-1",
      }),
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(watchDurableRun).not.toHaveBeenCalled();
  });

  it("still picks up a run nobody is watching", async () => {
    stubRuns([RUNNING]);

    renderHook(() =>
      useDurableRunRecovery({
        activeSessionId: "A",
        isReady: true,
        updateSession: () => {},
        isRunWatched: () => false,
      }),
    );

    await waitFor(() => expect(watchDurableRun).toHaveBeenCalledWith("run-1", expect.anything()));
  });
});
