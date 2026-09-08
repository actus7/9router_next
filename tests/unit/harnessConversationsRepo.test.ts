import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn((fn: () => void) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, transaction })),
}));

import { replaceHarnessConversations } from "@/lib/db/repos/harnessConversationsRepo";

const session = {
  id: "session-1",
  title: "Session",
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

describe("replaceHarnessConversations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes search rows for sessions omitted from a replacement", async () => {
    await replaceHarnessConversations([session]);

    const statements = run.mock.calls.map(([sql]) => String(sql));
    // One search table now, not two: the Postgres index is a generated column
    // on harnessMessageIndex, so there is no companion FTS table to clear.
    const index = statements.findIndex((sql) => sql.includes("DELETE FROM harnessMessageIndex"));
    const events = statements.findIndex((sql) => sql.includes("DELETE FROM harnessEvents"));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(events).toBeGreaterThan(index);
  });

  it("clears the search table when all sessions are deleted", async () => {
    await replaceHarnessConversations([]);

    expect(run).toHaveBeenCalledWith("DELETE FROM harnessMessageIndex WHERE userId = ?", ["test-user"]);
    expect(run).toHaveBeenCalledWith("DELETE FROM harnessConversations WHERE userId = ?", ["test-user"]);
  });
});
