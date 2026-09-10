import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The answer has to land in the conversation without any browser.
 *
 * The worker settled the run row and stopped there, leaving the answer to be
 * folded in by `useDurableRunRecovery` — which only looks at the session that
 * is open, and only if a browser comes back at all. A settled row expires after
 * `SETTLED_RUN_TTL_MS` (24h), so closing the laptop for a day lost a finished
 * answer that the server had already paid for.
 *
 * This was not safe to do before: the client replaced the whole conversation
 * table on every sync, so a server-side write was raced away. Sync is
 * incremental now, which is what makes the transcript writable from here.
 */

const rows = vi.hoisted(() => new Map<string, { data: string; updatedAt: string }>());

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({
    get: vi.fn(async (sql: string, params: unknown[]) => {
      if (!sql.includes("FROM harnessConversations")) return undefined;
      const row = rows.get(String(params[1]));
      return row ? { id: params[1], data: row.data, updatedAt: row.updatedAt } : undefined;
    }),
    run: vi.fn(async (sql: string, params: unknown[]) => {
      if (!sql.startsWith("UPDATE harnessConversations")) return { changes: 0 };
      const [data, updatedAt, , id] = params as string[];
      if (!rows.has(id)) return { changes: 0 };
      rows.set(id, { data, updatedAt });
      return { changes: 1 };
    }),
    all: vi.fn(async () => []),
    transaction: (fn: () => unknown) => fn(),
  })),
}));

import { appendRunAnswerToConversation } from "@/lib/db/repos/harnessConversationsRepo";

function seed(sessionId: string, messages: unknown[]) {
  rows.set(sessionId, {
    data: JSON.stringify({ messages }),
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function messagesOf(sessionId: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(rows.get(sessionId)!.data) as { messages: Array<Record<string, unknown>> };
  return parsed.messages;
}

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

describe("appendRunAnswerToConversation", () => {
  it("fills in the placeholder the client left streaming", async () => {
    seed("s1", [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "", status: "streaming" },
    ]);

    await appendRunAnswerToConversation("s1", "a1", { content: "the answer", status: "done" });

    expect(messagesOf("s1")).toEqual([
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "the answer", status: "done" },
    ]);
  });

  it("appends the answer when the placeholder never reached the server", async () => {
    // The tab died before its sync, so the conversation has the user's turn
    // and nothing else. The answer still belongs in it.
    seed("s2", [{ id: "u1", role: "user", content: "hello" }]);

    await appendRunAnswerToConversation("s2", "a9", { content: "late answer", status: "done" });

    const messages = messagesOf("s2");
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ id: "a9", role: "assistant", content: "late answer", status: "done" });
  });

  it("moves updatedAt forward so a stale client copy cannot win", async () => {
    seed("s3", [{ id: "a1", role: "assistant", content: "", status: "streaming" }]);

    await appendRunAnswerToConversation("s3", "a1", { content: "x", status: "done" });

    expect(Date.parse(rows.get("s3")!.updatedAt)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("does nothing when the conversation is not on the server yet", async () => {
    await expect(
      appendRunAnswerToConversation("missing", "a1", { content: "x", status: "done" }),
    ).resolves.toBe(false);
  });

  it("leaves an empty answer alone rather than writing a blank turn", async () => {
    seed("s4", [{ id: "a1", role: "assistant", content: "", status: "streaming" }]);

    await expect(
      appendRunAnswerToConversation("s4", "a1", { content: "", status: "done" }),
    ).resolves.toBe(false);
    expect(messagesOf("s4")[0]).toMatchObject({ status: "streaming" });
  });
});
