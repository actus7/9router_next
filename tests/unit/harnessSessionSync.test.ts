import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sync must not delete by omission.
 *
 * `replaceHarnessConversations` deleted every row missing from the payload, and
 * the client's only gate on sending one was a ref set in a `.finally` — armed
 * even when the initial GET had failed. A transient 429 on a fresh browser was
 * therefore enough to replace the account's whole history with one empty
 * conversation, and two tabs deleted each other's work the same way.
 *
 * Deletions are explicit now: what is not mentioned is left alone.
 */

const run = vi.hoisted(() => vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const get = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => undefined as unknown));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({
    run,
    get,
    all: vi.fn(async () => []),
    transaction: (fn: () => unknown) => fn(),
  })),
}));

import { syncHarnessConversations } from "@/lib/db/repos/harnessConversationsRepo";

function statements(): string[] {
  return run.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
}

const session = {
  id: "s1",
  title: "Kept",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  run.mockReturnValue({ changes: 1 });
  get.mockResolvedValue(undefined);
});

describe("syncHarnessConversations", () => {
  it("never deletes a conversation the payload simply did not mention", async () => {
    await syncHarnessConversations({ upserts: [session], deletedIds: [] });

    expect(statements().some((sql) => sql.startsWith("DELETE"))).toBe(false);
    expect(statements().some((sql) => sql.startsWith("INSERT INTO harnessConversations"))).toBe(true);
  });

  it("deletes exactly the ids it was told to delete, with their child rows", async () => {
    await syncHarnessConversations({ upserts: [], deletedIds: ["gone"] });

    const deletes = statements().filter((sql) => sql.startsWith("DELETE"));
    expect(deletes.some((sql) => sql.includes("harnessConversations") && sql.includes("id IN"))).toBe(true);
    expect(deletes.some((sql) => sql.includes("harnessEvents"))).toBe(true);
    expect(deletes.some((sql) => sql.includes("harnessMessageIndex"))).toBe(true);
    // Same rule as before: a row whose worker is mid-write is never swept.
    expect(deletes.find((sql) => sql.includes("harnessRuns"))).toContain("status !=");
    for (const sql of deletes) expect(sql).toContain("userId = ?");
  });

  it("refuses a client copy older than the server's, and says which", async () => {
    // The worker writes finished answers into the conversation now, so the
    // server can legitimately hold a newer copy than a tab that has been idle.
    // Overwriting it would erase an answer the account already paid for.
    run.mockReturnValue({ changes: 0 });
    get.mockResolvedValue({ updatedAt: "2026-06-01T00:00:00.000Z" });

    const result = await syncHarnessConversations({ upserts: [session], deletedIds: [] });

    expect(result.stale).toEqual(["s1"]);
  });

  it("reports an upsert that wrote nothing instead of answering ok", async () => {
    // `harnessConversations.id` is a global primary key and the upsert is
    // guarded by `WHERE userId = excluded.userId`, so an id already owned by
    // another account matched no row, changed nothing, and still answered 200 —
    // a client that believed it had synced forever.
    run.mockReturnValue({ changes: 0 });
    get.mockResolvedValue(undefined);

    await expect(syncHarnessConversations({ upserts: [session], deletedIds: [] })).rejects.toThrow(/s1/);
  });

  it("does nothing at all when there is nothing to do", async () => {
    await syncHarnessConversations({ upserts: [], deletedIds: [] });
    expect(run).not.toHaveBeenCalled();
  });
});
