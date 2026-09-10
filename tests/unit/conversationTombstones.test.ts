import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A deletion has to converge across devices.
 *
 * Sync is per-device and additive, and from a client "absent from the server"
 * and "never synced" look identical — so a phone still holding a conversation
 * locally re-uploaded it, and deleting on the desktop un-deleted itself. The
 * tombstone is the missing third state.
 */

const run = vi.hoisted(() => vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })));
const all = vi.hoisted(() => vi.fn(async (_sql: string, _params?: unknown[]) => [] as Record<string, unknown>[]));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({
    run,
    get: vi.fn(async () => undefined),
    all,
    transaction: (fn: () => unknown) => fn(),
  })),
}));

import {
  listDeletedConversationIds,
  syncHarnessConversations,
} from "@/lib/db/repos/harnessConversationsRepo";

function statements(): string[] {
  return run.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  run.mockReturnValue({ changes: 1 });
  all.mockResolvedValue([]);
});

describe("conversation tombstones", () => {
  it("records a tombstone for every conversation it deletes", async () => {
    await syncHarnessConversations({ upserts: [], deletedIds: ["gone"] });

    const insert = statements().find((sql) => sql.includes("INSERT INTO harnessDeletedConversations"));
    expect(insert).toBeDefined();
    expect(insert).toContain("ON CONFLICT");
  });

  it("clears the tombstone when the same id comes back as an upsert", async () => {
    // Creating a conversation that reuses a deleted id must not be shadowed by
    // its own tombstone, or it would vanish on the next device that syncs.
    await syncHarnessConversations({
      upserts: [{ id: "reused", title: "T", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      deletedIds: [],
    });

    const remove = statements().find((sql) => sql.startsWith("DELETE FROM harnessDeletedConversations"));
    expect(remove).toBeDefined();
    expect(remove).toContain("userId = ?");
  });

  it("sweeps tombstones past their TTL rather than keeping them forever", async () => {
    await syncHarnessConversations({ upserts: [], deletedIds: ["gone"] });

    const sweep = statements().filter((sql) => sql.startsWith("DELETE FROM harnessDeletedConversations"));
    expect(sweep.some((sql) => sql.includes("deletedAt <"))).toBe(true);
  });

  it("reports the ids a returning device must drop", async () => {
    all.mockResolvedValue([{ id: "gone" }, { id: "also-gone" }]);

    expect(await listDeletedConversationIds()).toEqual(["gone", "also-gone"]);
    const [sql, params] = all.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("userId = ?");
    expect(params[0]).toBe("test-user");
  });
});
