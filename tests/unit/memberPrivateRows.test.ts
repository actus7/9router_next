import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Inside one organization, conversations, runs, their search index and a
 * member's own memory are private to that member. The tenant filter alone
 * would hand every member's chat history to every other member, so each of
 * these statements must also be bound to the acting member — and an upsert
 * must never overwrite a row another member owns.
 */

const calls = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);
const changes = vi.hoisted(() => ({ value: 1 }));
const getRow = vi.hoisted(() => ({ value: undefined as Record<string, unknown> | undefined }));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({
    get: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return getRow.value;
    }),
    all: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [];
    }),
    run: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { changes: changes.value };
    }),
    transaction: (fn: () => unknown) => fn(),
  })),
}));

import { withTenant } from "@/lib/db/tenant";
import { appendHarnessEvent, listHarnessConversations, syncHarnessConversations } from "@/lib/db/repos/harnessConversationsRepo";
import { listHarnessRunsSince } from "@/lib/db/repos/harnessRunsRepo";
import { searchPastSessionMessages, upsertHarnessMessageIndex } from "@/lib/db/repos/harnessMessageIndexRepo";
import { listAgentMemoryEntries } from "@/lib/db/repos/agentMemoryRepo";

const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

beforeEach(() => {
  calls.length = 0;
  changes.value = 1;
  getRow.value = undefined;
});

const asMemberB = <T>(fn: () => Promise<T>): Promise<T> =>
  withTenant({ tenantId: "org-1", actorUserId: "member-b", role: "member" }, fn);

describe("member-private rows", () => {
  it("lists only the acting member's conversations", async () => {
    await asMemberB(() => listHarnessConversations());
    expect(flat(calls[0]!.sql)).toContain("userId = ? AND COALESCE(ownerUserId, userId) = ?");
    expect(calls[0]!.params).toEqual(["org-1", "member-b"]);
  });

  it("never lets a sync overwrite another member's conversation, and reports it", async () => {
    changes.value = 0; // the guarded DO UPDATE matched nothing
    const result = await asMemberB(() => syncHarnessConversations({
      upserts: [{ id: "c1", title: "t", createdAt: "2026-01-01", updatedAt: "2026-01-02" } as never],
      deletedIds: [],
    }));
    const upsert = calls.find((call) => flat(call.sql).startsWith("INSERT INTO harnessConversations"))!;
    expect(flat(upsert.sql)).toContain(
      "AND COALESCE(harnessConversations.ownerUserId, harnessConversations.userId) = excluded.ownerUserId",
    );
    expect(upsert.params.at(-1)).toBe("member-b");
    // The follow-up read is member-scoped, so another member's row reads as absent.
    expect(result.rejected).toEqual(["c1"]);
  });

  it("deletes only the acting member's conversations and their rows", async () => {
    await asMemberB(() => syncHarnessConversations({ upserts: [], deletedIds: ["c1"] }));
    const deletes = calls.filter((call) => flat(call.sql).startsWith("DELETE FROM harness") && !flat(call.sql).includes("deletedAt <"));
    expect(deletes.length).toBeGreaterThan(3);
    for (const call of deletes) {
      expect(call.params.slice(0, 2)).toEqual(["org-1", "member-b"]);
    }
  });

  it("scopes runs and the cross-session search to the member", async () => {
    await asMemberB(() => listHarnessRunsSince("s1", null));
    await asMemberB(() => searchPastSessionMessages({ query: "hello" }));
    for (const call of calls) {
      expect(flat(call.sql)).toContain("COALESCE(ownerUserId, userId) = ?");
      expect(call.params).toContain("member-b");
    }
  });

  it("shares agent memory with the organization and keeps user memory personal", async () => {
    await asMemberB(() => listAgentMemoryEntries());
    expect(flat(calls[0]!.sql)).toContain("(scope = 'agent' OR COALESCE(ownerUserId, userId) = ?)");
    expect(calls[0]!.params).toEqual(["org-1", "member-b"]);
  });

  it("never lets the search index overwrite another member's message", async () => {
    await asMemberB(() => upsertHarnessMessageIndex({
      sessionId: "s1", messageId: "m1", role: "user", content: "hello", createdAt: "2026-01-01",
    }));
    expect(flat(calls[0]!.sql)).toContain(
      "WHERE COALESCE(harnessMessageIndex.ownerUserId, harnessMessageIndex.userId) = excluded.ownerUserId",
    );
  });

  it("refuses an event for a session another member owns", async () => {
    getRow.value = { nextSeq: 4, otherowners: 1 };
    await expect(asMemberB(() => appendHarnessEvent({ sessionId: "s1", type: "x", data: {} } as never)))
      .rejects.toThrow(/another member/);
    expect(calls.some((call) => flat(call.sql).startsWith("INSERT INTO harnessEvents"))).toBe(false);
  });

  it("asks the conversation too, so a session with no events yet cannot be claimed", async () => {
    getRow.value = { nextSeq: 1, otherowners: 0 };
    await asMemberB(() => appendHarnessEvent({ sessionId: "s1", type: "x", data: {} } as never));
    const check = flat(calls[0]!.sql);
    expect(check).toContain("FROM harnessConversations");
    expect(check).toContain("COALESCE(c.ownerUserId, c.userId) <> ?");
  });
});
