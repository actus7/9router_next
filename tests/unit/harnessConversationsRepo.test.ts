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
    const fts = statements.findIndex((sql) => sql.includes("DELETE FROM harnessMessageFts"));
    const index = statements.findIndex((sql) => sql.includes("DELETE FROM harnessMessageIndex"));
    const events = statements.findIndex((sql) => sql.includes("DELETE FROM harnessEvents"));
    expect(fts).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(events).toBeGreaterThan(index);
  });

  it("clears both search tables when all sessions are deleted", async () => {
    await replaceHarnessConversations([]);

    expect(run).toHaveBeenCalledWith("DELETE FROM harnessMessageFts");
    expect(run).toHaveBeenCalledWith("DELETE FROM harnessMessageIndex");
  });
});
