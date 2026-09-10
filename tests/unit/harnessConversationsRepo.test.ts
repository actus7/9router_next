import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn((fn: () => void) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, transaction })),
}));

import { appendHarnessEvent, syncHarnessConversations } from "@/lib/db/repos/harnessConversationsRepo";

const session = {
  id: "session-1",
  title: "Session",
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

describe("syncHarnessConversations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the search rows of a deleted session before the session itself", async () => {
    await syncHarnessConversations({ upserts: [session], deletedIds: ["gone"] });

    const statements = run.mock.calls.map(([sql]) => String(sql));
    // One search table now, not two: the Postgres index is a generated column
    // on harnessMessageIndex, so there is no companion FTS table to clear.
    const index = statements.findIndex((sql) => sql.includes("DELETE FROM harnessMessageIndex"));
    const events = statements.findIndex((sql) => sql.includes("DELETE FROM harnessEvents"));
    const conversations = statements.findIndex((sql) => sql.includes("DELETE FROM harnessConversations"));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(events).toBeGreaterThan(index);
    expect(conversations).toBeGreaterThan(events);
  });

  it("touches nothing when no session was upserted or deleted", async () => {
    await syncHarnessConversations({ upserts: [], deletedIds: [] });

    expect(run).not.toHaveBeenCalled();
  });
});

function seqConflict(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "harnessevents_pkey"'),
    { code: "23505" },
  );
}

describe("appendHarnessEvent", () => {
  beforeEach(() => {
    run.mockReset();
    get.mockReset();
  });

  it("retries with a fresh number when a concurrent append took the sequence", async () => {
    // Both requests read MAX(seq) = 2 and compute 3; the loser's INSERT hits
    // harnessEvents_pkey. By the retry the winner has committed, so the
    // re-read yields 4 instead of a 500.
    get.mockResolvedValueOnce({ nextSeq: 3 }).mockResolvedValueOnce({ nextSeq: 4 });
    run.mockRejectedValueOnce(seqConflict()).mockResolvedValueOnce({ changes: 1 });

    const event = await appendHarnessEvent({ sessionId: "session-1", type: "tool", data: { ok: true } });

    expect(event.seq).toBe(4);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("propagates an error that is not a sequence conflict", async () => {
    get.mockResolvedValue({ nextSeq: 1 });
    run.mockRejectedValue(Object.assign(new Error("connection terminated"), { code: "08006" }));

    await expect(appendHarnessEvent({ sessionId: "session-1", type: "tool", data: {} }))
      .rejects.toThrow("connection terminated");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
