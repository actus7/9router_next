import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guards a review put on durable runs, each pinned to the scenario that
 * asked for it. Every one of these was a real hole, not a hypothetical.
 */

const run = vi.hoisted(() => vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const get = vi.hoisted(() => vi.fn(() => ({ total: 0 }) as Record<string, unknown> | undefined));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, transaction: (fn: () => unknown) => fn() })),
}));

import { syncHarnessConversations } from "@/lib/db/repos/harnessConversationsRepo";
import { countRunningHarnessRuns, failStaleHarnessRuns, settleHarnessRun } from "@/lib/db/repos/harnessRunsRepo";

function statements(): string[] {
  return run.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
}

describe("session sync must not delete a live run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    run.mockReturnValue({ changes: 1 });
  });

  it("spares running rows when a deleted session is swept", async () => {
    // `PUT /api/harness/sessions` used to replace the conversation table
    // wholesale, every 350ms while a chat was active, sweeping `harnessRuns`
    // for any session missing from the payload — including one whose worker was
    // mid-write. The row vanished under the worker and the answer was lost with
    // no error raised anywhere. Sync only deletes what it is told to now, but
    // the guard still has to hold for the session the user really did delete.
    await syncHarnessConversations({ upserts: [], deletedIds: ["gone"] });

    const sweep = statements().find((sql) => sql.startsWith("DELETE FROM harnessRuns"));
    expect(sweep).toBeDefined();
    expect(sweep).toContain("status !=");
  });
});

describe("run bookkeeping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    run.mockReturnValue({ changes: 1 });
    get.mockReturnValue({ total: 0 });
  });

  it("counts only this account's running rows", async () => {
    get.mockReturnValue({ total: 3 });
    expect(await countRunningHarnessRuns()).toBe(3);

    const [sql, params] = get.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("userId = ?");
    expect(params[0]).toBe("test-user");
  });

  it("only settles a row that is still running, so a stop is not overwritten", async () => {
    // The worker learns about a stop by a write that matches nothing. Its final
    // settle skipped that guard, so a stop landing inside the last progress
    // interval — up to a second at the end of every answer — was overwritten by
    // `completed`, and the user got the whole reply after asking it to stop.
    await settleHarnessRun("run-1", { status: "completed", partialText: "done" });

    const settle = statements().find((sql) => sql.startsWith("UPDATE harnessRuns SET status"));
    expect(settle).toBeDefined();
    expect(settle).toContain("status = ?");
    expect(run.mock.calls[0]?.[1]).toContain("running");
  });

  it("drops settled rows nobody ever collected", async () => {
    // Runs are normally deleted when a client folds them in. Nothing collected
    // them on the happy path, so without a TTL the table only ever grew.
    await failStaleHarnessRuns();

    const sweep = statements().find((sql) => sql.startsWith("DELETE FROM harnessRuns"));
    expect(sweep).toBeDefined();
    expect(sweep).toContain("updatedAt <");
    expect(sweep).toContain("userId = ?");
  });
});
